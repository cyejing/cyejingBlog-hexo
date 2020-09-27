---
title : Netty源码解析-写数据
tags : [netty]
date: 2020-09-26
---

# 写数据 

#### ctx.writeAndFlush 方法

当我们调用此方法时，会从当前节点找上一个 outbound 节点，并调用下个节点的 write 方法。具体看代码：

```java
//AbstractChannelHandlerContext
@Override
public ChannelFuture writeAndFlush(Object msg) {
  return writeAndFlush(msg, newPromise());
}
@Override
public ChannelFuture writeAndFlush(Object msg, ChannelPromise promise) {
  if (msg == null) {
    throw new NullPointerException("msg");
  }

  // 校验Promise是不有效
  if (isNotValidPromise(promise, true)) {
    ReferenceCountUtil.release(msg);
    // cancelled
    return promise;
  }

  write(msg, true, promise);

  return promise;
}

// 实际写入方法
private void write(Object msg, boolean flush, ChannelPromise promise) {
  // 找到上一个Outbound节点
  AbstractChannelHandlerContext next = findContextOutbound();
  // 记录该对接Counter
  final Object m = pipeline.touch(msg, next);
  EventExecutor executor = next.executor();
  // Netty到处用到的，如果是EventLoop则让当前线程一路往下执行，减少线程上下文切换
  if (executor.inEventLoop()) {
    if (flush) {
      next.invokeWriteAndFlush(m, promise);
    } else {
      next.invokeWrite(m, promise);
    }
  } else {
    // 封装成task，最后还是异步执行next.invokeWrite**
    AbstractWriteTask task;
    if (flush) {
      task = WriteAndFlushTask.newInstance(next, m, promise);
    }  else {
      task = WriteTask.newInstance(next, m, promise);
    }
    safeExecute(executor, task, promise, m);
  }
}

//DefaultChannelPipeline.HeadContext
//经过Pipeline一路调用write最后到headContext
@Override
public void write(ChannelHandlerContext ctx, Object msg, ChannelPromise promise) throws Exception {
  // 调用到unsafe write
  unsafe.write(msg, promise);
}

//AbstractChannel
@Override
public final void write(Object msg, ChannelPromise promise) {
  assertEventLoop();

  // 写操作的缓冲区
  ChannelOutboundBuffer outboundBuffer = this.outboundBuffer;
  if (outboundBuffer == null) {
    // If the outboundBuffer is null we know the channel was closed and so
    // need to fail the future right away. If it is not null the handling of the rest
    // will be done in flush0()
    // See https://github.com/netty/netty/issues/2362
    safeSetFailure(promise, WRITE_CLOSED_CHANNEL_EXCEPTION);
    // release message now to prevent resource-leak
    ReferenceCountUtil.release(msg);
    return;
  }

  int size;
  try {
    //	将ByteBuf转成DirectByteBuf，堆外内存写入socket，零拷贝特性
    msg = filterOutboundMessage(msg);
    size = pipeline.estimatorHandle().size(msg);
    if (size < 0) {
      size = 0;
    }
  } catch (Throwable t) {
    safeSetFailure(promise, t);
    ReferenceCountUtil.release(msg);
    return;
  }

  //将准备好的数据放到写缓冲区，完毕
  outboundBuffer.addMessage(msg, size, promise);
}
```

### 总结

写数据的方式主要经过Pipeline的outbound节点，到达headContext之后调用Unsafe写消息，这里写入的消息仅仅是写到ChannelOutboundBuffer缓冲区。

下文解析ChannelOutboundBuffer

