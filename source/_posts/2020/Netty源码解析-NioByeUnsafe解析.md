---
title : Netty源码解析-NioByeUnsafe解析
tags : [netty]
date: 2020-07-10
---


### NioByteUnsafe

当Channel有读事件到来，会调用到``Unsafe``读取Socket缓冲区数据，并包装成 Netty 的 ByteBuf 对象，最后传递进 pipeline 中的所有节点完成处理。

```java
// AbstractNioByteChannel.NioByteUnsafe
@Override
public final void read() {
  // 获取Channel的Config对象
  final ChannelConfig config = config();
  // 获取Channel对应的Pipeline
  final ChannelPipeline pipeline = pipeline();
  // 获取内存分配器，用来处理内存的分配:池化或者非池化 UnpooledByteBufAllocator
  final ByteBufAllocator allocator = config.getAllocator();
  // 用来计算此次读循环应该分配多少内存 AdaptiveRecvByteBufAllocator 自适应计算缓冲分配
  final RecvByteBufAllocator.Handle allocHandle = recvBufAllocHandle();
  // 将内存分配处理重置
  allocHandle.reset(config);

  ByteBuf byteBuf = null;
  boolean close = false;
  try {
    do {
      // 申请一块可操作的内存
      byteBuf = allocHandle.allocate(allocator);
      // 记录读取到的字节数
      allocHandle.lastBytesRead(doReadBytes(byteBuf));
      // 如果上一次读到的字节数小于等于0，清理引用和跳出循环
      if (allocHandle.lastBytesRead() <= 0) {
        // nothing was read. release the buffer.
        byteBuf.release();
        byteBuf = null;
        close = allocHandle.lastBytesRead() < 0;
        // 如果远程已经关闭连接
        if (close) {
          // There is nothing left to read as we received an EOF.
          readPending = false;
        }
        break;
      }

      allocHandle.incMessagesRead(1);
      readPending = false;
      // 每读取到一次数据就传递到pipeline内部处理
      pipeline.fireChannelRead(byteBuf);
      byteBuf = null;
      // 满足配置项，是否自动读取,是否满足预计读取字节数，是否小于最大读取次数，读到的数据是否大于0
    } while (allocHandle.continueReading());

    allocHandle.readComplete();
    pipeline.fireChannelReadComplete();

    if (close) {
      closeOnRead(pipeline);
    }
  } catch (Throwable t) {
    handleReadException(pipeline, byteBuf, t, close, allocHandle);
  } finally {
    // Check if there is a readPending which was not processed yet.
    // This could be for two reasons:
    // * The user called Channel.read() or ChannelHandlerContext.read() in channelRead(...) method
    // * The user called Channel.read() or ChannelHandlerContext.read() in channelReadComplete(...) method
    //
    // See https://github.com/netty/netty/issues/2254
    if (!readPending && !config.isAutoRead()) {
      removeReadOp();
    }
  }
}

//DefaultMaxMessagesRecvByteBufAllocator.MaxMessageHandle
@Override
public boolean continueReading(UncheckedBooleanSupplier maybeMoreDataSupplier) {
  // 满足配置项，是否自动读取,是否满足预计读取字节数，是否小于最大读取次数，读到的数据是否大于0
  return config.isAutoRead() &&
    maybeMoreDataSupplier.get() &&
    totalMessages < maxMessagePerRead &&
    totalBytesRead > 0;
}
```

<!--more-->

### ByteBufAllocator

首先看看这个节点的定义：

> Implementations are responsible to allocate buffers. Implementations of this interface are expected to be hread-safe.
> 实现负责分配缓冲区。这个接口的实现应该是线程安全的。

```java
buffer() // 返回一个 ByteBuf 对象，默认直接内存。如果平台不支持，返回堆内存。
heapBuffer（）// 返回堆内存缓存区
directBuffer（）// 返回直接内存缓冲区
compositeBuffer（） // 返回一个复合缓冲区。可能同时包含堆内存和直接内存。
ioBuffer（） // 当当支持 Unsafe 时，返回直接内存的 Bytebuf，否则返回返回基于堆内存，当使用PreferHeapByteBufAllocator 时返回堆内存
```

主要作用是创建 ByteBuf，这个 ByteBuf 是 Netty 用来替代 NIO 的 ByteBuffer 的，是存储数据的缓存区。其中，这个接口有一个默认实现 ByteBufUtil.DEFAULT_ALLOCATOR ：该实现根据配置创建一个 池化或非池化的缓存区分配器。该参数是 `io.netty.allocator.type`。

### RecvByteBufAllocator.Handle

> Creates a new handle. The handle provides the actual operations and keeps the internal information which is required for predicting an optimal buffer capacity.
> 创建一个新的句柄。句柄提供了实际操作，并保留了用于预测最佳缓冲区容量所需的内部信息。

```java
//RecvByteBufAllocator.Handle
ByteBuf allocate(ByteBufAllocator alloc);//创建一个新的接收缓冲区，其容量可能大到足以读取所有入站数据和小到数据足够不浪费它的空间。
int guess();// 猜测所需的缓冲区大小，不进行实际的分配
void reset(ChannelConfig config);// 每次开始读循环之前，重置相关属性
void incMessagesRead(int numMessages);// 增加本地读循环的次数
void lastBytesRead(int bytes); // 设置最后一次读到的字节数
int lastBytesRead(); // 最后一次读到的字节数
void attemptedBytesRead(int bytes); // 设置读操作尝试读取的字节数
void attemptedBytesRead(); // 获取尝试读取的字节数
boolean continueReading(); // 判断是否需要继续读
void readComplete(); // 读结束后调用
```

该接口的主要作用就是计算字节数，如同 RecvByteBufAllocator 的文档说的那样，根据预测和计算最佳大小的缓存区，确保不浪费。

### 将数据读取到ByteBuf

```java
//NioSocketChannel
@Override
protected int doReadBytes(ByteBuf byteBuf) throws Exception {
  final RecvByteBufAllocator.Handle allocHandle = unsafe().recvBufAllocHandle();
  // 记录可读到的字节数
  allocHandle.attemptedBytesRead(byteBuf.writableBytes());
  return byteBuf.writeBytes(javaChannel(), allocHandle.attemptedBytesRead());
}
```

