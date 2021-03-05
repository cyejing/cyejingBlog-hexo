---
title : Dubbo解析-服务导出
tags : [Dubbo]
date : 2021-2-20
---

## 服务导出
### dubbo的领域对象

在dubbo当中它的核心领域对象就是Invoker，它是 Dubbo 的核心模型，其它模型都向它靠扰，或转换成它。
在dubbo中通过Protocol这个来管理Invoker的生命周期，包括服务的暴露与引用都是通过它来完成的。而在进行服务调用的时候通过Invocation来保存调用过程中的变量：包括方法名，参数等。所以在整个dubbo调用过程当中：

- Invoker 是实体域，它是 Dubbo 的核心模型，其它模型都向它靠扰，或转换成它，它代表一个可执行体，可向它发起 invoke 调用，它有可能是一个本地的实现，也可能是一个远程的实现，也可能一个集群实现。
- Protocol 是服务域，它是 Invoker 暴露和引用的主功能入口，它负责 Invoker 的生命周期管理。
- Invocation 是会话域，它持有调用过程中的变量，比如方法名，参数等。

### dubbo的服务导出

{% asset_img dubbo-export.jpg %}

![/dev-guide/images/dubbo_rpc_refer.jpg](Dubbo解析-服务导出/dubbo_rpc_refer-20210305150423921.jpg)

服务提供者暴露一个服务的详细过程

{% asset_img format.jpeg %}


上图是服务提供者暴露服务的主过程：

首先 ServiceConfig 类拿到对外提供服务的实际类 ref(如：HelloWorldImpl),然后通过 ProxyFactory 类的 getInvoker 方法使用 ref 生成一个 AbstractProxyInvoker 实例，到这一步就完成具体服务到 Invoker 的转化。接下来就是 Invoker 转换到 Exporter 的过程。

Dubbo 处理服务暴露的关键就在 Invoker 转换到 Exporter 的过程

<!--more-->

源码入口:

```java
// ServiceConfig
public synchronized void export() {
  // 检查配置
  checkAndUpdateSubConfigs();

  if (!shouldExport()) {
    return;
  }

  if (shouldDelay()) {
    DELAY_EXPORT_EXECUTOR.schedule(this::doExport, getDelay(), TimeUnit.MILLISECONDS);
  } else {
    // 执行暴露逻辑
    doExport();
  }
}

// 执行暴露逻辑
protected synchronized void doExport() {
  if (unexported) {
    throw new IllegalStateException("The service " + interfaceClass.getName() + " has already unexported!");
  }
  if (exported) {
    return;
  }
  exported = true;

  if (StringUtils.isEmpty(path)) {
    path = interfaceName;
  }
  doExportUrls();
}

private void doExportUrls() {
  // 加载所有注册中心
  List<URL> registryURLs = loadRegistries(true);
  for (ProtocolConfig protocolConfig : protocols) {
    String pathKey = URL.buildKey(getContextPath(protocolConfig).map(p -> p + "/" + path).orElse(path), group, version);
    ProviderModel providerModel = new ProviderModel(pathKey, ref, interfaceClass);
    ApplicationModel.initProviderModel(pathKey, providerModel);
    // 协议暴露
    doExportUrlsFor1Protocol(protocolConfig, registryURLs);
  }
}
```

### 导出dubbo服务

前置工作做完，接下来就可以进行服务导出了。服务导出分为导出到本地 (JVM)，和导出到远程。在深入分析服务导出的源码前，我们先来从宏观层面上看一下服务导出逻辑。如下：

```java
private void doExportUrlsFor1Protocol(ProtocolConfig protocolConfig, List<URL> registryURLs) {
    
    // 省略无关代码
    
    if (ExtensionLoader.getExtensionLoader(ConfiguratorFactory.class)
            .hasExtension(url.getProtocol())) {
        // 加载 ConfiguratorFactory，并生成 Configurator 实例，然后通过实例配置 url
        url = ExtensionLoader.getExtensionLoader(ConfiguratorFactory.class)
                .getExtension(url.getProtocol()).getConfigurator(url).configure(url);
    }

    String scope = url.getParameter(Constants.SCOPE_KEY);
    // 如果 scope = none，则什么都不做
    if (!Constants.SCOPE_NONE.toString().equalsIgnoreCase(scope)) {
        // scope != remote，导出到本地
        if (!Constants.SCOPE_REMOTE.toString().equalsIgnoreCase(scope)) {
            exportLocal(url);
        }

        // scope != local，导出到远程
        if (!Constants.SCOPE_LOCAL.toString().equalsIgnoreCase(scope)) {
            if (registryURLs != null && !registryURLs.isEmpty()) {
                for (URL registryURL : registryURLs) {
                    url = url.addParameterIfAbsent(Constants.DYNAMIC_KEY, registryURL.getParameter(Constants.DYNAMIC_KEY));
                    // 加载监视器链接
                    URL monitorUrl = loadMonitor(registryURL);
                    if (monitorUrl != null) {
                        // 将监视器链接作为参数添加到 url 中
                        url = url.addParameterAndEncoded(Constants.MONITOR_KEY, monitorUrl.toFullString());
                    }

                    String proxy = url.getParameter(Constants.PROXY_KEY);
                    if (StringUtils.isNotEmpty(proxy)) {
                        registryURL = registryURL.addParameter(Constants.PROXY_KEY, proxy);
                    }

                    // 为服务提供类(ref)生成 Invoker
                    Invoker<?> invoker = proxyFactory.getInvoker(ref, (Class) interfaceClass, registryURL.addParameterAndEncoded(Constants.EXPORT_KEY, url.toFullString()));
                    // DelegateProviderMetaDataInvoker 用于持有 Invoker 和 ServiceConfig
                    DelegateProviderMetaDataInvoker wrapperInvoker = new DelegateProviderMetaDataInvoker(invoker, this);

                    // 导出服务，并生成 Exporter
                    Exporter<?> exporter = protocol.export(wrapperInvoker);
                    exporters.add(exporter);
                }
                
            // 不存在注册中心，仅导出服务
            } else {
                Invoker<?> invoker = proxyFactory.getInvoker(ref, (Class) interfaceClass, url);
                DelegateProviderMetaDataInvoker wrapperInvoker = new DelegateProviderMetaDataInvoker(invoker, this);

                Exporter<?> exporter = protocol.export(wrapperInvoker);
                exporters.add(exporter);
            }
        }
    }
    this.urls.add(url);
}
```

### 导出服务到本地

本节我们来看一下服务导出相关的代码，按照代码执行顺序，本节先来分析导出服务到本地的过程。相关代码如下：

```java
private void exportLocal(URL url) {
    // 如果 URL 的协议头等于 injvm，说明已经导出到本地了，无需再次导出
    if (!Constants.LOCAL_PROTOCOL.equalsIgnoreCase(url.getProtocol())) {
        URL local = URL.valueOf(url.toFullString())
            .setProtocol(Constants.LOCAL_PROTOCOL)    // 设置协议头为 injvm
            .setHost(LOCALHOST)
            .setPort(0);
        ServiceClassHolder.getInstance().pushServiceClass(getServiceClass(ref));
        // 创建 Invoker，并导出服务，这里的 protocol 会在运行时调用 InjvmProtocol 的 export 方法
        Exporter<?> exporter = protocol.export(
            proxyFactory.getInvoker(ref, (Class) interfaceClass, local));
        exporters.add(exporter);
    }
}
```

exportLocal 方法比较简单，首先根据 URL 协议头决定是否导出服务。若需导出，则创建一个新的 URL 并将协议头、主机名以及端口设置成新的值。然后创建 Invoker，并调用 InjvmProtocol 的 export 方法导出服务。下面我们来看一下 InjvmProtocol 的 export 方法都做了哪些事情。

```java
public <T> Exporter<T> export(Invoker<T> invoker) throws RpcException {
    // 创建 InjvmExporter
    return new InjvmExporter<T>(invoker, invoker.getUrl().getServiceKey(), exporterMap);
}
```

如上，InjvmProtocol 的 export 方法仅创建了一个 InjvmExporter，无其他逻辑。到此导出服务到本地就分析完了，接下来，我们继续分析导出服务到远程的过程。

### 导出服务到远程

与导出服务到本地相比，导出服务到远程的过程要复杂不少，其包含了服务导出与服务注册两个过程。这两个过程涉及到了大量的调用，比较复杂。按照代码执行顺序，本节先来分析服务导出逻辑，服务注册逻辑将在下一节进行分析。下面开始分析，我们把目光移动到 RegistryProtocol 的 export 方法上。

```java
public <T> Exporter<T> export(final Invoker<T> originInvoker) throws RpcException {
    // 导出服务
    final ExporterChangeableWrapper<T> exporter = doLocalExport(originInvoker);

    // 获取注册中心 URL，以 zookeeper 注册中心为例，得到的示例 URL 如下：
    // zookeeper://127.0.0.1:2181/com.alibaba.dubbo.registry.RegistryService?application=demo-provider&dubbo=2.0.2&export=dubbo%3A%2F%2F172.17.48.52%3A20880%2Fcom.alibaba.dubbo.demo.DemoService%3Fanyhost%3Dtrue%26application%3Ddemo-provider
    URL registryUrl = getRegistryUrl(originInvoker);

    // 根据 URL 加载 Registry 实现类，比如 ZookeeperRegistry
    final Registry registry = getRegistry(originInvoker);
    
    // 获取已注册的服务提供者 URL，比如：
    // dubbo://172.17.48.52:20880/com.alibaba.dubbo.demo.DemoService?anyhost=true&application=demo-provider&dubbo=2.0.2&generic=false&interface=com.alibaba.dubbo.demo.DemoService&methods=sayHello
    final URL registeredProviderUrl = getRegisteredProviderUrl(originInvoker);

    // 获取 register 参数
    boolean register = registeredProviderUrl.getParameter("register", true);

    // 向服务提供者与消费者注册表中注册服务提供者
    ProviderConsumerRegTable.registerProvider(originInvoker, registryUrl, registeredProviderUrl);

    // 根据 register 的值决定是否注册服务
    if (register) {
        // 向注册中心注册服务
        register(registryUrl, registeredProviderUrl);
        ProviderConsumerRegTable.getProviderWrapper(originInvoker).setReg(true);
    }

    // 获取订阅 URL，比如：
    // provider://172.17.48.52:20880/com.alibaba.dubbo.demo.DemoService?category=configurators&check=false&anyhost=true&application=demo-provider&dubbo=2.0.2&generic=false&interface=com.alibaba.dubbo.demo.DemoService&methods=sayHello
    final URL overrideSubscribeUrl = getSubscribedOverrideUrl(registeredProviderUrl);
    // 创建监听器
    final OverrideListener overrideSubscribeListener = new OverrideListener(overrideSubscribeUrl, originInvoker);
    overrideListeners.put(overrideSubscribeUrl, overrideSubscribeListener);
    // 向注册中心进行订阅 override 数据
    registry.subscribe(overrideSubscribeUrl, overrideSubscribeListener);
    // 创建并返回 DestroyableExporter
    return new DestroyableExporter<T>(exporter, originInvoker, overrideSubscribeUrl, registeredProviderUrl);
}
```

上面代码看起来比较复杂，主要做如下一些操作：

1. 调用 doLocalExport 导出服务
2. 向注册中心注册服务
3. 向注册中心进行订阅 override 数据
4. 创建并返回 DestroyableExporter

在以上操作中，除了创建并返回 DestroyableExporter 没什么难度外，其他几步操作都不是很简单。这其中，导出服务和注册服务是本章要重点分析的逻辑。 订阅 override 数据并非本文重点内容，后面会简单介绍一下。下面先来分析 doLocalExport 方法的逻辑，如下：

```java
private <T> ExporterChangeableWrapper<T> doLocalExport(final Invoker<T> originInvoker) {
    String key = getCacheKey(originInvoker);
    // 访问缓存
    ExporterChangeableWrapper<T> exporter = (ExporterChangeableWrapper<T>) bounds.get(key);
    if (exporter == null) {
        synchronized (bounds) {
            exporter = (ExporterChangeableWrapper<T>) bounds.get(key);
            if (exporter == null) {
                // 创建 Invoker 为委托类对象
                final Invoker<?> invokerDelegete = new InvokerDelegete<T>(originInvoker, getProviderUrl(originInvoker));
                // 调用 protocol 的 export 方法导出服务
                exporter = new ExporterChangeableWrapper<T>((Exporter<T>) protocol.export(invokerDelegete), originInvoker);
                
                // 写缓存
                bounds.put(key, exporter);
            }
        }
    }
    return exporter;
}
```

上面的代码是典型的双重检查锁，大家在阅读 Dubbo 的源码中，会多次见到。接下来，我们把重点放在 Protocol 的 export 方法上。假设运行时协议为 dubbo，此处的 protocol 变量会在运行时加载 DubboProtocol，并调用 DubboProtocol 的 export 方法。所以，接下来我们目光转移到 DubboProtocol 的 export 方法上，相关分析如下：

```java
public <T> Exporter<T> export(Invoker<T> invoker) throws RpcException {
    URL url = invoker.getUrl();

    // 获取服务标识，理解成服务坐标也行。由服务组名，服务名，服务版本号以及端口组成。比如：
    // demoGroup/com.alibaba.dubbo.demo.DemoService:1.0.1:20880
    String key = serviceKey(url);
    // 创建 DubboExporter
    DubboExporter<T> exporter = new DubboExporter<T>(invoker, key, exporterMap);
    // 将 <key, exporter> 键值对放入缓存中
    exporterMap.put(key, exporter);

    // 本地存根相关代码
    Boolean isStubSupportEvent = url.getParameter(Constants.STUB_EVENT_KEY, Constants.DEFAULT_STUB_EVENT);
    Boolean isCallbackservice = url.getParameter(Constants.IS_CALLBACK_SERVICE, false);
    if (isStubSupportEvent && !isCallbackservice) {
        String stubServiceMethods = url.getParameter(Constants.STUB_EVENT_METHODS_KEY);
        if (stubServiceMethods == null || stubServiceMethods.length() == 0) {
            // 省略日志打印代码
        } else {
            stubServiceMethodsMap.put(url.getServiceKey(), stubServiceMethods);
        }
    }

    // 启动服务器
    openServer(url);
    // 优化序列化
    optimizeSerialization(url);
    return exporter;
}
```

如上，我们重点关注 DubboExporter 的创建以及 openServer 方法，其他逻辑看不懂也没关系，不影响理解服务导出过程。另外，DubboExporter 的代码比较简单，就不分析了。下面分析 openServer 方法。

```java
private void openServer(URL url) {
    // 获取 host:port，并将其作为服务器实例的 key，用于标识当前的服务器实例
    String key = url.getAddress();
    boolean isServer = url.getParameter(Constants.IS_SERVER_KEY, true);
    if (isServer) {
        // 访问缓存
        ExchangeServer server = serverMap.get(key);
        if (server == null) {
            // 创建服务器实例
            serverMap.put(key, createServer(url));
        } else {
            // 服务器已创建，则根据 url 中的配置重置服务器
            server.reset(url);
        }
    }
}
```

如上，在同一台机器上（单网卡），同一个端口上仅允许启动一个服务器实例。若某个端口上已有服务器实例，此时则调用 reset 方法重置服务器的一些配置。考虑到篇幅问题，关于服务器实例重置的代码就不分析了。接下来分析服务器实例的创建过程。如下：

```java
private ExchangeServer createServer(URL url) {
    url = url.addParameterIfAbsent(Constants.CHANNEL_READONLYEVENT_SENT_KEY,
    // 添加心跳检测配置到 url 中
    url = url.addParameterIfAbsent(Constants.HEARTBEAT_KEY, String.valueOf(Constants.DEFAULT_HEARTBEAT));
	// 获取 server 参数，默认为 netty
    String str = url.getParameter(Constants.SERVER_KEY, Constants.DEFAULT_REMOTING_SERVER);

	// 通过 SPI 检测是否存在 server 参数所代表的 Transporter 拓展，不存在则抛出异常
    if (str != null && str.length() > 0 && !ExtensionLoader.getExtensionLoader(Transporter.class).hasExtension(str))
        throw new RpcException("Unsupported server type: " + str + ", url: " + url);

    // 添加编码解码器参数
    url = url.addParameter(Constants.CODEC_KEY, DubboCodec.NAME);
    ExchangeServer server;
    try {
        // 创建 ExchangeServer
        server = Exchangers.bind(url, requestHandler);
    } catch (RemotingException e) {
        throw new RpcException("Fail to start server...");
    }
                                   
	// 获取 client 参数，可指定 netty，mina
    str = url.getParameter(Constants.CLIENT_KEY);
    if (str != null && str.length() > 0) {
        // 获取所有的 Transporter 实现类名称集合，比如 supportedTypes = [netty, mina]
        Set<String> supportedTypes = ExtensionLoader.getExtensionLoader(Transporter.class).getSupportedExtensions();
        // 检测当前 Dubbo 所支持的 Transporter 实现类名称列表中，
        // 是否包含 client 所表示的 Transporter，若不包含，则抛出异常
        if (!supportedTypes.contains(str)) {
            throw new RpcException("Unsupported client type...");
        }
    }
    return server;
}
```

如上，createServer 包含三个核心的逻辑。第一是检测是否存在 server 参数所代表的 Transporter 拓展，不存在则抛出异常。第二是创建服务器实例。第三是检测是否支持 client 参数所表示的 Transporter 拓展，不存在也是抛出异常。两次检测操作所对应的代码比较直白了，无需多说。但创建服务器的操作目前还不是很清晰，我们继续往下看。

```java
public static ExchangeServer bind(URL url, ExchangeHandler handler) throws RemotingException {
    if (url == null) {
        throw new IllegalArgumentException("url == null");
    }
    if (handler == null) {
        throw new IllegalArgumentException("handler == null");
    }
    url = url.addParameterIfAbsent(Constants.CODEC_KEY, "exchange");
    // 获取 Exchanger，默认为 HeaderExchanger。
    // 紧接着调用 HeaderExchanger 的 bind 方法创建 ExchangeServer 实例
    return getExchanger(url).bind(url, handler);
}
```

上面代码比较简单，就不多说了。下面看一下 HeaderExchanger 的 bind 方法。

```java
public ExchangeServer bind(URL url, ExchangeHandler handler) throws RemotingException {
	// 创建 HeaderExchangeServer 实例，该方法包含了多个逻辑，分别如下：
	//   1. new HeaderExchangeHandler(handler)
	//	 2. new DecodeHandler(new HeaderExchangeHandler(handler))
	//   3. Transporters.bind(url, new DecodeHandler(new HeaderExchangeHandler(handler)))
    return new HeaderExchangeServer(Transporters.bind(url, new DecodeHandler(new HeaderExchangeHandler(handler))));
}
```

HeaderExchanger 的 bind 方法包含的逻辑比较多，但目前我们仅需关心 Transporters 的 bind 方法逻辑即可。该方法的代码如下：

```java
public static Server bind(URL url, ChannelHandler... handlers) throws RemotingException {
    if (url == null) {
        throw new IllegalArgumentException("url == null");
    }
    if (handlers == null || handlers.length == 0) {
        throw new IllegalArgumentException("handlers == null");
    }
    ChannelHandler handler;
    if (handlers.length == 1) {
        handler = handlers[0];
    } else {
    	// 如果 handlers 元素数量大于1，则创建 ChannelHandler 分发器
        handler = new ChannelHandlerDispatcher(handlers);
    }
    // 获取自适应 Transporter 实例，并调用实例方法
    return getTransporter().bind(url, handler);
}
```

如上，getTransporter() 方法获取的 Transporter 是在运行时动态创建的，类名为 Transporter$Adaptive，也就是自适应拓展类。Transporter$Adaptive 会在运行时根据传入的 URL 参数决定加载什么类型的 Transporter，默认为 NettyTransporter。下面我们继续跟下去，这次分析的是 NettyTransporter 的 bind 方法。

```java
public Server bind(URL url, ChannelHandler listener) throws RemotingException {
	// 创建 NettyServer
	return new NettyServer(url, listener);
}
```

这里仅有一句创建 NettyServer 的代码，无需多说，我们继续向下看。

```java
public class NettyServer extends AbstractServer implements Server {
    public NettyServer(URL url, ChannelHandler handler) throws RemotingException {
        // 调用父类构造方法
        super(url, ChannelHandlers.wrap(handler, ExecutorUtil.setThreadName(url, SERVER_THREAD_POOL_NAME)));
    }
}


public abstract class AbstractServer extends AbstractEndpoint implements Server {
    public AbstractServer(URL url, ChannelHandler handler) throws RemotingException {
        // 调用父类构造方法，这里就不用跟进去了，没什么复杂逻辑
        super(url, handler);
        localAddress = getUrl().toInetSocketAddress();

        // 获取 ip 和端口
        String bindIp = getUrl().getParameter(Constants.BIND_IP_KEY, getUrl().getHost());
        int bindPort = getUrl().getParameter(Constants.BIND_PORT_KEY, getUrl().getPort());
        if (url.getParameter(Constants.ANYHOST_KEY, false) || NetUtils.isInvalidLocalHost(bindIp)) {
            // 设置 ip 为 0.0.0.0
            bindIp = NetUtils.ANYHOST;
        }
        bindAddress = new InetSocketAddress(bindIp, bindPort);
        // 获取最大可接受连接数
        this.accepts = url.getParameter(Constants.ACCEPTS_KEY, Constants.DEFAULT_ACCEPTS);
        this.idleTimeout = url.getParameter(Constants.IDLE_TIMEOUT_KEY, Constants.DEFAULT_IDLE_TIMEOUT);
        try {
            // 调用模板方法 doOpen 启动服务器
            doOpen();
        } catch (Throwable t) {
            throw new RemotingException("Failed to bind ");
        }

        DataStore dataStore = ExtensionLoader.getExtensionLoader(DataStore.class).getDefaultExtension();
        executor = (ExecutorService) dataStore.get(Constants.EXECUTOR_SERVICE_COMPONENT_KEY, Integer.toString(url.getPort()));
    }
    
    protected abstract void doOpen() throws Throwable;

    protected abstract void doClose() throws Throwable;
}
```

上面代码多为赋值代码，不需要多讲。我们重点关注 doOpen 抽象方法，该方法需要子类实现。下面回到 NettyServer 中。

```java
protected void doOpen() throws Throwable {
    NettyHelper.setNettyLoggerFactory();
    // 创建 boss 和 worker 线程池
    ExecutorService boss = Executors.newCachedThreadPool(new NamedThreadFactory("NettyServerBoss", true));
    ExecutorService worker = Executors.newCachedThreadPool(new NamedThreadFactory("NettyServerWorker", true));
    ChannelFactory channelFactory = new NioServerSocketChannelFactory(boss, worker, getUrl().getPositiveParameter(Constants.IO_THREADS_KEY, Constants.DEFAULT_IO_THREADS));
    
    // 创建 ServerBootstrap
    bootstrap = new ServerBootstrap(channelFactory);

    final NettyHandler nettyHandler = new NettyHandler(getUrl(), this);
    channels = nettyHandler.getChannels();
    bootstrap.setOption("child.tcpNoDelay", true);
    // 设置 PipelineFactory
    bootstrap.setPipelineFactory(new ChannelPipelineFactory() {
        @Override
        public ChannelPipeline getPipeline() {
            NettyCodecAdapter adapter = new NettyCodecAdapter(getCodec(), getUrl(), NettyServer.this);
            ChannelPipeline pipeline = Channels.pipeline();
            pipeline.addLast("decoder", adapter.getDecoder());
            pipeline.addLast("encoder", adapter.getEncoder());
            pipeline.addLast("handler", nettyHandler);
            return pipeline;
        }
    });
    // 绑定到指定的 ip 和端口上
    channel = bootstrap.bind(getBindAddress());
}
```

以上就是 NettyServer 创建的过程，dubbo 默认使用的 NettyServer 是基于 netty 3.x 版本实现的，比较老了。因此 Dubbo 另外提供了 netty 4.x 版本的 NettyServer，大家可在使用 Dubbo 的过程中按需进行配置。

到此，关于服务导出的过程就分析完了。整个过程比较复杂，大家在分析的过程中耐心一些。并且多写 Demo 进行调试，以便能够更好的理解代码逻辑。

本节内容先到这里，接下来分析服务导出的另一块逻辑 — 服务注册。

### 服务注册

本节我们来分析服务注册过程，服务注册操作对于 Dubbo 来说不是必需的，通过服务直连的方式就可以绕过注册中心。但通常我们不会这么做，直连方式不利于服务治理，仅推荐在测试服务时使用。对于 Dubbo 来说，注册中心虽不是必需，但却是必要的。因此，关于注册中心以及服务注册相关逻辑，我们也需要搞懂。

本节内容以 Zookeeper 注册中心作为分析目标，其他类型注册中心大家可自行分析。下面从服务注册的入口方法开始分析，我们把目光再次移到 RegistryProtocol 的 export 方法上。如下：

```java
public <T> Exporter<T> export(final Invoker<T> originInvoker) throws RpcException {
    
    // ${导出服务}
    
    // 省略其他代码
    
    boolean register = registeredProviderUrl.getParameter("register", true);
    if (register) {
        // 注册服务
        register(registryUrl, registeredProviderUrl);
        ProviderConsumerRegTable.getProviderWrapper(originInvoker).setReg(true);
    }
    
    final URL overrideSubscribeUrl = getSubscribedOverrideUrl(registeredProviderUrl);
    final OverrideListener overrideSubscribeListener = new OverrideListener(overrideSubscribeUrl, originInvoker);
    overrideListeners.put(overrideSubscribeUrl, overrideSubscribeListener);
    // 订阅 override 数据
    registry.subscribe(overrideSubscribeUrl, overrideSubscribeListener);

    // 省略部分代码
}
```

RegistryProtocol 的 export 方法包含了服务导出，注册，以及数据订阅等逻辑。其中服务导出逻辑上一节已经分析过了，本节将分析服务注册逻辑，相关代码如下：

```java
public void register(URL registryUrl, URL registedProviderUrl) {
    // 获取 Registry
    Registry registry = registryFactory.getRegistry(registryUrl);
    // 注册服务
    registry.register(registedProviderUrl);
}
```

register 方法包含两步操作，第一步是获取注册中心实例，第二步是向注册中心注册服务。接下来分两节内容对这两步操作进行分析。
