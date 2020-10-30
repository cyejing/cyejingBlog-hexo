---
title : Netty源码解析-Netty源码解析-ChannelOutboundBuffer解析
tags : [Netty]
date: 2020-09-26
---

## ChannelOutboundBuffer解析

每个 ChannelSocket 的 Unsafe 都有一个绑定的 ChannelOutboundBuffer ， Netty 向站外输出数据的过程统一通过 ChannelOutboundBuffer 类进行封装，目的是为了提高网络的吞吐量，在外面调用 write 的时候，数据并没有写到 Socket，而是写到了 ChannelOutboundBuffer 这里，当调用 flush 的时候，才真正的向 Socket 写出。

> (Transport implementors only) an internal data structure used by AbstractChannel to store its pending outbound write requests.
> All methods must be called by a transport implementation from an I/O thread。
> 意思是，这个一个数据传输的实现者，一个内部的数据结构用于存储等待的出站写请求。所有的方法都必有由 IO 线程来调用。

```java
private Entry flushedEntry; // 即将被消费的开始节点
private Entry unflushedEntry;// 被添加的开始节点，但没有准备好被消费。
private Entry tailEntry;// 最后一个节点
```
在调用 addFlush 方法的时候会将 unflushedEntry 赋值给 flushedEntry

{% asset_img 1240-20200928104014643.png %}

调用 addMessage 方法的时候，创建一个 Entry ，将这个 Entry 追加到 TailEntry 节点后面，调用 addFlush 的时候，将 unflushedEntry 的引用赋给 flushedEntry，然后将 unflushedEntry 置为 null。

当数据被写进 Socket 后，从 flushedEntry（current） 节点开始，循环将每个节点删除。

<!--more-->

### addMessage	

>Add given message to this ChannelOutboundBuffer. The given ChannelPromise will be notified once the message was written.
>将给定的消息添加到 ChannelOutboundBuffer，一旦消息被写入，就会通知 promise。

```java
//ChannelOutboundBuffer
public void addMessage(Object msg, int size, ChannelPromise promise) {
  //Entry是循环利用的，在线程ThreadLocal里面有Stack放了可以循环利用的对象
  Entry entry = Entry.newInstance(msg, size, total(msg), promise);
  //新对象放到尾部
  if (tailEntry == null) {
    flushedEntry = null;
    tailEntry = entry;
  } else {
    Entry tail = tailEntry;
    tail.next = entry;
    tailEntry = entry;
  }
  if (unflushedEntry == null) {
    unflushedEntry = entry;
  }

  // increment pending bytes after adding message to the unflushed arrays.
  // See https://github.com/netty/netty/issues/1619
  incrementPendingOutboundBytes(entry.pendingSize, false);
}
```

### addFlush

```java
// ChannelOutboundBuffer
public void addFlush() {
  // There is no need to process all entries if there was already a flush before and no new messages
  // where added in the meantime.
  //
  // See https://github.com/netty/netty/issues/2577
  Entry entry = unflushedEntry;
  if (entry != null) {
    if (flushedEntry == null) {
      // there is no flushedEntry yet, so start with the entry
      // flushedEntry 设置到头节点
      flushedEntry = entry;
    }
    do {
      flushed ++;
      // 设置是否已经取消节点
      if (!entry.promise.setUncancellable()) {
        // Was cancelled so make sure we free up memory and notify about the freed bytes
        int pending = entry.cancel();
        decrementPendingOutboundBytes(pending, false, true);
      }
      entry = entry.next;
    } while (entry != null);

    // All flushed so reset unflushedEntry
    unflushedEntry = null;
  }
}
```

### flush0

```java
//AbstractChannel.AbstractUnsafe 
protected void flush0() {
  ...
  try {
    // 调用到子类的doWrite具体实现
    doWrite(outboundBuffer);
  } catch (Throwable t) {
  	....
  } finally {
    inFlush0 = false;
  }
}

//NioSocketChannel
@Override
protected void doWrite(ChannelOutboundBuffer in) throws Exception {
  for (;;) {
    int size = in.size();
    if (size == 0) {
      // All written so clear OP_WRITE
      clearOpWrite();
      break;
    }
    long writtenBytes = 0;
    boolean done = false;
    boolean setOpWrite = false;

    // Ensure the pending writes are made of ByteBufs only.
    // 拿到缓冲区的buffer
    ByteBuffer[] nioBuffers = in.nioBuffers();
    int nioBufferCnt = in.nioBufferCount();
    long expectedWrittenBytes = in.nioBufferSize();
    // 拿到NIO Socket
    SocketChannel ch = javaChannel();

    // Always us nioBuffers() to workaround data-corruption.
    // See https://github.com/netty/netty/issues/2761
    switch (nioBufferCnt) {
      case 0:
        // We have something else beside ByteBuffers to write so fallback to normal writes.
        super.doWrite(in);
        return;
      case 1:
        // Only one ByteBuf so use non-gathering write
        ByteBuffer nioBuffer = nioBuffers[0];
        // 获取自旋的次数，默认16
        for (int i = config().getWriteSpinCount() - 1; i >= 0; i --) {
          final int localWrittenBytes = ch.write(nioBuffer);
          if (localWrittenBytes == 0) {
            setOpWrite = true;
            break;
          }
          expectedWrittenBytes -= localWrittenBytes;
          writtenBytes += localWrittenBytes;
          if (expectedWrittenBytes == 0) {
            done = true;
            break;
          }
        }
        break;
      default:
        // 获取自旋的次数，默认16
        for (int i = config().getWriteSpinCount() - 1; i >= 0; i --) {
          final long localWrittenBytes = ch.write(nioBuffers, 0, nioBufferCnt);
          // SocketChannel写入的数据为0 说明tcp缓冲区满了，setOpWrite则注册写事件 等待写事件的通知
          if (localWrittenBytes == 0) {
            setOpWrite = true;
            break;
          }
          expectedWrittenBytes -= localWrittenBytes;
          writtenBytes += localWrittenBytes;
          if (expectedWrittenBytes == 0) {
            done = true;
            break;
          }
        }
        break;
    }

    // Release the fully written buffers, and update the indexes of the partially written buffer.
    in.removeBytes(writtenBytes);

    // done=false 说明buffer的数据没有完全写到SocketChannel 
    
    // setOpWrite=true 说明Tcp缓冲区达到水位线了，则注册写事件到Selector，当有可写事件的时候再进行写操作,有写事件的时候会调用ch.unsafe().forceFlush()
    // setOpWrite=false 说明要写的数据太多循环16次不能写完，放入队列，待会儿马上处理
    
    if (!done) {
      // Did not write all buffers completely.
      incompleteWrite(setOpWrite);
      break;
    }
  }
}
```



## 缓冲区扩展思考

ChannelOutboundBuffer 是没有大小限制的链表。可能会导致 OOM，Netty 已经考虑了这个问题，在　addMessage　方法的最后一行，incrementPendingOutboundBytes方法，会判断　totalPendingSize　的大小是否超过了高水位阈值（默认64 kb），如果超过，关闭写开关，调用 piepeline 的 fireChannelWritabilityChanged 方法可改变 flush 策略。

关于 channelWritabilityChanged API，Netty 这样解释：

> 当 Channel 的可写状态发生改变时被调用。用户可以确保写操作不会完成的太快（以避免发生 OOM）或者可以在 Channel 变为再次可写时恢复写入。可以通过调用 Channel 的 isWritable 方法来检测 Channel 的可写性。与可写性相关的阈值可以通过 Channel.config().setWriteBufferHighWaterMark 和 Channel.config().setWriteBufferLowWaterMark 方法来设置，默认最小 32 kb，最大 64 kb。

那么，上面时候恢复可写状态呢？remove 的时候，或者 addFlush 是丢弃了某个节点，会对 totalPendingSize 进行削减，削减之后进行判断。如果 totalPendingSize 小于最低水位了。就恢复写入。