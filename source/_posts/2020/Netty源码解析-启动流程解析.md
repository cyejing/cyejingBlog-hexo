---
title : Netty源码解析-启动流程解析
tags : [netty]
date: 2020-07-10
---


# 启动流程

1. 主入口``ServerBootstrap.bind()``方法.

2. 进入``AbstractBootstrap.doBind()``方法

   <!--more-->
   
   ```java
    private ChannelFuture doBind(final SocketAddress localAddress) {
           // 初始化连接,如果是server端,server端重写init方法
           final ChannelFuture regFuture = initAndRegister();
           final Channel channel = regFuture.channel();
           if (regFuture.cause() != null) {
               return regFuture;
           }
   
           if (regFuture.isDone()) {
               // At this point we know that the registration was complete and successful.
               ChannelPromise promise = channel.newPromise();
               //  真正去绑定端口
               doBind0(regFuture, channel, localAddress, promise);
               return promise;
           } else {
               final PendingRegistrationPromise promise = new PendingRegistrationPromise(channel);
               regFuture.addListener(new ChannelFutureListener() {
                   @Override
                   public void operationComplete(ChannelFuture future) throws Exception {
                       Throwable cause = future.cause();
                       if (cause != null) {
                           promise.setFailure(cause);
                       } else {
                           promise.registered();
                         	//	异步绑定端口
                           doBind0(regFuture, channel, localAddress, promise);
                       }
                   }
               });
               return promise;
           }
       }	
   ```
   
3. 进入``AbstractBootstrap .initAndRegister``方法

      ```java
      final ChannelFuture initAndRegister() {
              Channel channel = null;
              try {
                	// 调用具体的Channel实现类Nio?Epoll? 如Nio调用到Jdk原生的ServerSocketChannel
                  channel = channelFactory.newChannel();
                	// 调用初始化，ServerBootstrap实现了初始化方法
                  init(channel);
              } catch (Throwable t) {
                  if (channel != null) {
                      // channel can be null if newChannel crashed (eg SocketException("too many open files"))
                      channel.unsafe().closeForcibly();
                      // as the Channel is not registered yet we need to force the usage of the GlobalEventExecutor
                      return new DefaultChannelPromise(channel, GlobalEventExecutor.INSTANCE).setFailure(t);
                  }
                  // as the Channel is not registered yet we need to force the usage of the GlobalEventExecutor
                  return new DefaultChannelPromise(new FailedChannel(), GlobalEventExecutor.INSTANCE).setFailure(t);
              }
      
        			//	调用注册方法，将Channel注册到EventLoop的Selector 里面，这里一个EventLoop对应多个Channel
              ChannelFuture regFuture = config().group().register(channel);
              if (regFuture.cause() != null) {
                  if (channel.isRegistered()) {
                      channel.close();
                  } else {
                      channel.unsafe().closeForcibly();
                  }
              }
      
              return regFuture;
          }
      ```

4. 当``regFuture``完成的时候开始执行``dobind0()``

      ```java
       private static void doBind0(
                  final ChannelFuture regFuture, final Channel channel,
                  final SocketAddress localAddress, final ChannelPromise promise) {
      
              // This method is invoked before channelRegistered() is triggered.  Give user handlers a chance to set up
              // the pipeline in its channelRegistered() implementation.
         			// 当注册channle注册到eventLoop之后才开始执行bind
         			// 绑定的逻辑再pipeline的Head节点，调用jdk 的原生代码进行bind
              channel.eventLoop().execute(new Runnable() {
                  @Override
                  public void run() {
                      if (regFuture.isSuccess()) {
                          channel.bind(localAddress, promise).addListener(ChannelFutureListener.CLOSE_ON_FAILURE);
                      } else {
                          promise.setFailure(regFuture.cause());
                      }
                  }
              });
          }	
      ```

5. 调用到``DefaultChannelPipeline.HeadContext.bind()``,继续调用到``unsafe``实现

   ```java
       @Override
           public void bind(
                   ChannelHandlerContext ctx, SocketAddress localAddress, ChannelPromise promise) {
               unsafe.bind(localAddress, promise);
           }
   ```

6. 之后调用到``NioServerSocketChannel.doBind``实现

   ```java
    protected void doBind(SocketAddress localAddress) throws Exception {
           if (PlatformDependent.javaVersion() >= 7) {
               javaChannel().bind(localAddress, config.getBacklog());
           } else {
               javaChannel().socket().bind(localAddress, config.getBacklog());
           }
       }
   ```

7. 回过头，整个流程已经完成Channel和EventLoop的绑定，并且执行了端口的绑定

8. 接下来看看ServerBootstrap怎么把BossEventLoopGroup接收到的Channel移交到WorkEventLoopGroup

9. 

