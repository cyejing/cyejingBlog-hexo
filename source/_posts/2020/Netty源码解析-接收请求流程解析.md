---
title : Netty源码解析-接收请求流程解析
tags : [netty]
date: 2020-07-10
---


# 接收请求流程 

1. Channel和EventLoop绑定好之后，接收请求由EventLoop循环去监听。由``NioEventLoop.processSelectedKey``进入

   <!--more-->

   ```java
   // NioEventLoop.java 
   private void processSelectedKey(SelectionKey k, AbstractNioChannel ch) {
     final AbstractNioChannel.NioUnsafe unsafe = ch.unsafe();
     if (!k.isValid()) {
       final EventLoop eventLoop;
       try {
         eventLoop = ch.eventLoop();
       } catch (Throwable ignored) {
         return;
       }
   
       if (eventLoop == this) {
         unsafe.close(unsafe.voidPromise());
       }
       return;
     }
   
     try {
       int readyOps = k.readyOps();
       if ((readyOps & SelectionKey.OP_CONNECT) != 0) {
         int ops = k.interestOps();
         ops &= ~SelectionKey.OP_CONNECT;
         k.interestOps(ops);
         unsafe.finishConnect();
       }
   
       if ((readyOps & SelectionKey.OP_WRITE) != 0) {
         ch.unsafe().forceFlush();
       }
       // 可读事件，调用unsafe读
       if ((readyOps & (SelectionKey.OP_READ | SelectionKey.OP_ACCEPT)) != 0 || readyOps == 0) {
         unsafe.read();
       }
     } catch (CancelledKeyException ignored) {
       unsafe.close(unsafe.voidPromise());
     }
   }
   ```

2. ``unsafe``分别有两个实现``NioMessageUnsafe``和``NioByteUnsafe``前者用于Boss接收Channel连接，后者用于接收byte字节

   ```java
   // AbstractNioMessageChannel.java
   public void read() {
     assert eventLoop().inEventLoop();
     final ChannelConfig config = config();
     final ChannelPipeline pipeline = pipeline();
     final RecvByteBufAllocator.Handle allocHandle = unsafe().recvBufAllocHandle();
     allocHandle.reset(config);
   
     boolean closed = false;
     Throwable exception = null;
     try {
       try {
         do {
           //  调用Nio具体实现读消息
           int localRead = doReadMessages(readBuf);
           if (localRead == 0) {
             break;
           }
           if (localRead < 0) {
             closed = true;
             break;
           }
   
           allocHandle.incMessagesRead(localRead);
         } while (allocHandle.continueReading());
       } catch (Throwable t) {
         exception = t;
       }
   
       int size = readBuf.size();
       for (int i = 0; i < size; i ++) {
         readPending = false;
         // 循环将读到的消息，发送到pipeline
         pipeline.fireChannelRead(readBuf.get(i));
       }
       readBuf.clear();
       allocHandle.readComplete();
       pipeline.fireChannelReadComplete();
   
       if (exception != null) {
         closed = closeOnReadError(exception);
   
         pipeline.fireExceptionCaught(exception);
       }
   
       if (closed) {
         inputShutdown = true;
         if (isOpen()) {
           close(voidPromise());
         }
       }
     } finally {
       if (!readPending && !config.isAutoRead()) {
         removeReadOp();
       }
     }
   }
   }
   ```

   

3. 调用到``NioServerSocketChannel.doReadMessages()``,可以看到boss在这里创建子Channel集合,将集合作为pipeline的参数传递到Handler处理

   ```java
   // NioServerSocketChannel.java
   protected int doReadMessages(List<Object> buf) throws Exception {
     SocketChannel ch = SocketUtils.accept(javaChannel());
   
     try {
       if (ch != null) {
         buf.add(new NioSocketChannel(this, ch));
         return 1;
       }
     } catch (Throwable t) {
       logger.warn("Failed to create a new channel from an accepted socket.", t);
   
       try {
         ch.close();
       } catch (Throwable t2) {
         logger.warn("Failed to close a socket.", t2);
       }
     }
   
     return 0;
   }	
   ```

4. ServerBootstrap在初始化的时候已经有Handler去处理子Channel的创建``ServerBootstrapAcceptor``

   ```java
   // ServerBootstrapAcceptor.java
     public void channelRead(ChannelHandlerContext ctx, Object msg) {
       // msg 就是上一步解析出来的子Channel
       final Channel child = (Channel) msg;
   
       child.pipeline().addLast(childHandler);
   
       setChannelOptions(child, childOptions, logger);
       setAttributes(child, childAttrs);
   
       try {
         // 将子Channel注册到WorkEventLoop里面，并且注册读事件OP_READ
         childGroup.register(child).addListener(new ChannelFutureListener() {
           @Override
           public void operationComplete(ChannelFuture future) throws Exception {
             if (!future.isSuccess()) {
               forceClose(child, future.cause());
             }
           }
         });
       } catch (Throwable t) {
         forceClose(child, t);
       }
     }
   ```

5. 到这里服务端accept请求的流程已经解析，接下来还有子Channel接收byte字节的过程

6. 同样是EventLoop轮询读写事件，在``NioEventLoop.processSelectedKey``的时候``unsafe``的实现变成了``NioByteUnsafe``

   ```java
   //	AbstractNioByteChannel.java
   public final void read() {
     final ChannelConfig config = config();
     if (shouldBreakReadReady(config)) {
       clearReadPending();
       return;
     }
     final ChannelPipeline pipeline = pipeline();
     final ByteBufAllocator allocator = config.getAllocator();
     final RecvByteBufAllocator.Handle allocHandle = recvBufAllocHandle();
     allocHandle.reset(config);
   
     ByteBuf byteBuf = null;
     boolean close = false;
     try {
       do {
         byteBuf = allocHandle.allocate(allocator);
         //	调用子类的（NioSocketChannel）doReadBytes方法,读取字节到ByteBuf
         allocHandle.lastBytesRead(doReadBytes(byteBuf));
         if (allocHandle.lastBytesRead() <= 0) {
           // nothing was read. release the buffer.
           byteBuf.release();
           byteBuf = null;
           close = allocHandle.lastBytesRead() < 0;
           if (close) {
             // There is nothing left to read as we received an EOF.
             readPending = false;
           }
           break;
         }
   
         allocHandle.incMessagesRead(1);
         readPending = false;
         // 将读取到的ByteBuf传播到pipeline 触发handler
         pipeline.fireChannelRead(byteBuf);
         byteBuf = null;
       } while (allocHandle.continueReading());
   
       allocHandle.readComplete();
       pipeline.fireChannelReadComplete();
   
       if (close) {
         closeOnRead(pipeline);
       }
     } catch (Throwable t) {
       handleReadException(pipeline, byteBuf, t, close, allocHandle);
     } finally {
       if (!readPending && !config.isAutoRead()) {
         removeReadOp();
       }
     }
   }
   }
   ```

   

7. 接收请求分为Boss接收连接和Work接收字节，`NioSocketChannel`和`NioServerSocketChannel`

Channel类图如下

{% asset_img NioSocketChannel.png %}

Unsafe类图如下

{% asset_img Unsafe.png %}
