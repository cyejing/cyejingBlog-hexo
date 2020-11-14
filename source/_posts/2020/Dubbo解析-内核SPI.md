---
title : Dubbo解析-内核SPI
tags : [Dubbo]
date : 2020-11-10
---

## 内核SPI解析

Dubbo采用微内核+插件体系，使得设计优雅，扩展性强。

### 为什么不适用JDK自带SPI

在dubbo中它实现了一套自己的SPI机制。JDK标准的SPI会一次性实例化扩展点所有实现，如果有扩展实现初始化很耗时，但如果没用上也加载，会很浪费资源.

增加了对扩展点IoC和AOP的支持，一个扩展点可以直接setter注入其它扩展点。

### Dubbo SPI 约定

SPI文件的存储路径在以下三个文件路径：

- META-INF/dubbo/internal/ **dubbo内部实现的各种扩展都放在了这个目录了**
- META-INF/dubbo/
- META-INF/services/

### SPI注解说明

在dubbo SPI中最关键的类是ExtensionLoader。每个定义的spi的接口都会构建一个ExtensionLoader实例，存储在ExtensionLoader对象的`ConcurrentMap<Class<?>,ExtensionLoader<?>> EXTENSION_LOADERS`这个map对象中。

获取SPI对象的典型方式为：

```
Protocol protocol = ExtensionLoader.getExtensionLoader(Protocol.class).getAdaptiveExtension();
1
```

对于获取SPI对象的过程会在后面详细说明。

涉及到几个注解。下面我们就来简单的分析一下这些注解。

- @SPI:标识在dubbo中需要使用SPI的接口上，指定的SPI里面指定的值为默认值。
- @Adaptive:这个注解和@SPI注解配置使用，用于它可以标注在SPI接口扩展类上，也可以标注在SPI接口的方法上。如果这个注解标注在SPI接口实现的扩展类上时，获取的SPI实例对象就是标注了@Adaptive注册的类。例如：ExtensionFactory的SPI扩展对象为AdaptiveExtensionFactory。如果注解在标注在SPI接口的方法上说明就是一个动态代理类，它会通过dubbo里面的`com.alibaba.dubbo.common.compiler.Compiler`SPI接口通过字节码技术来创建对象。创建出来的对象名格式为`SPI接口$Adaptive`，例如Protocol接口创建的SPI对象为Protocol$Adaptive。
- @Activate： 是一个 Duboo 框架提供的注解。在 Dubbo 官方文档上有记载：
  对于集合类扩展点，比如：Filter, InvokerListener, ExportListener, TelnetHandler, StatusChecker等， 可以同时加载多个实现，此时，可以用自动激活来简化配置。

### SPI解析实现类**ExtensionLoader**

在这个类里面有几个重要的方法：

- getExtensionLoader(Class type) 就是为该接口new 一个-ExtensionLoader，然后缓存起来。
- getAdaptiveExtension() 获取一个扩展类，如果@Adaptive注解在类上就是一个装饰类；如果注解在方法上就是一个动态代理类，例如Protocol$Adaptive对象。
- getExtension(String name) 获取一个指定对象。
- getActivateExtension(URL url, String[] values, String group)：方法主要获取当前扩展的所有可自动激活的实现标注了@Activate注解

##### getExtensionLoader方法

```java
public static <T> ExtensionLoader<T> getExtensionLoader(Class<T> type) {
  if (type == null) {
    throw new IllegalArgumentException("Extension type == null");
  }
  if (!type.isInterface()) {
    throw new IllegalArgumentException("Extension type (" + type + ") is not an interface!");
  }
  if (!withExtensionAnnotation(type)) {
    throw new IllegalArgumentException("Extension type (" + type +
                                       ") is not an extension, because it is NOT annotated with @" + SPI.class.getSimpleName() + "!");
  }

  // 从缓存Map里面取
  ExtensionLoader<T> loader = (ExtensionLoader<T>) EXTENSION_LOADERS.get(type);
  if (loader == null) {
    //如果缓存不存在，创建对应class对应的ExtensionLoader，并缓存
    EXTENSION_LOADERS.putIfAbsent(type, new ExtensionLoader<T>(type));
    loader = (ExtensionLoader<T>) EXTENSION_LOADERS.get(type);
  }
  return loader;
}

private ExtensionLoader(Class<?> type) {
  this.type = type;
	//当type不等于ExtensionFactory时候，创建ExtensionFactory 当调用ExtensionLoader#injectExtension方法的时候进行依赖注入
  objectFactory = (type == ExtensionFactory.class ? null : ExtensionLoader.getExtensionLoader(ExtensionFactory.class).getAdaptiveExtension());
}

```

##### getAdaptiveExtension方法

```java
public T getAdaptiveExtension() {
  // 获取缓存
  Object instance = cachedAdaptiveInstance.get();
  if (instance == null) {
    if (createAdaptiveInstanceError != null) {
      throw new IllegalStateException("Failed to create adaptive instance: " +
                                      createAdaptiveInstanceError.toString(),
                                      createAdaptiveInstanceError);
    }

    synchronized (cachedAdaptiveInstance) {
      instance = cachedAdaptiveInstance.get();
      if (instance == null) {
        try {
          // 缓存不存在，创建AdaptiveExtension
          instance = createAdaptiveExtension();
          cachedAdaptiveInstance.set(instance);
        } catch (Throwable t) {
          createAdaptiveInstanceError = t;
          throw new IllegalStateException("Failed to create adaptive instance: " + t.toString(), t);
        }
      }
    }
  }

  return (T) instance;
}

private T createAdaptiveExtension() {
  try {
    // 创建动态增强类，并且注入需要依赖的扩展 
    return injectExtension((T) getAdaptiveExtensionClass().newInstance());
  } catch (Exception e) {
    throw new IllegalStateException("Can't create adaptive extension " + type + ", cause: " + e.getMessage(), e);
  }
}
```

##### Adaptive创建过程

如果@Adaptive接口标注在@SPI接口的实现类上面就会直接返回这个对象的Class实例。如果标注在@SPI接口的方法上，就会通过dubbo中的字节码Compiler接口通过动态代理来创建SPI接口的实例。

相关方法在``getExtensionClasses`` ``cacheAdaptiveClass`` ``createAdaptiveExtensionClass``

创建出来的Adaptive代理类反编译代码，Protocol$Adaptive为例

```java
/*
 * Decompiled with CFR.
 */
package org.apache.dubbo.rpc;

import org.apache.dubbo.common.URL;
import org.apache.dubbo.common.extension.ExtensionLoader;
import org.apache.dubbo.rpc.Exporter;
import org.apache.dubbo.rpc.Invoker;
import org.apache.dubbo.rpc.Protocol;
import org.apache.dubbo.rpc.RpcException;

public class Protocol$Adaptive implements Protocol {
    @Override
    public void destroy() {
        throw new UnsupportedOperationException("The method public abstract void org.apache.dubbo.rpc.Protocol.destroy() of interface org.apache.dubbo.rpc.Protocol is not adaptive method!");
    }

    @Override
    public int getDefaultPort() {
        throw new UnsupportedOperationException("The method public abstract int org.apache.dubbo.rpc.Protocol.getDefaultPort() of interface org.apache.dubbo.rpc.Protocol is not adaptive method!");
    }

    public Exporter export(Invoker invoker) throws RpcException {
        String string;
        if (invoker == null) {
            throw new IllegalArgumentException("org.apache.dubbo.rpc.Invoker argument == null");
        }
        if (invoker.getUrl() == null) {
            throw new IllegalArgumentException("org.apache.dubbo.rpc.Invoker argument getUrl() == null");
        }
        URL uRL = invoker.getUrl();
      	// 根据URL的参数取出指定的协议类型
        String string2 = string = uRL.getProtocol() == null ? "dubbo" : uRL.getProtocol();
        if (string == null) {
            throw new IllegalStateException(new StringBuffer().append("Failed to get extension (org.apache.dubbo.rpc.Protocol) name from url (").append(uRL.toString()).append(") use keys([protocol])").toString());
        }
      	// 获取指定的协议实现
        Protocol protocol = ExtensionLoader.getExtensionLoader(Protocol.class).getExtension(string);
        return protocol.export(invoker);
    }

    public Invoker refer(Class class_, URL uRL) throws RpcException {
        String string;
        if (uRL == null) {
            throw new IllegalArgumentException("url == null");
        }
        URL uRL2 = uRL;
        String string2 = string = uRL2.getProtocol() == null ? "dubbo" : uRL2.getProtocol();
        if (string == null) {
            throw new IllegalStateException(new StringBuffer().append("Failed to get extension (org.apache.dubbo.rpc.Protocol) name from url (").append(uRL2.toString()).append(") use keys([protocol])").toString());
        }
        Protocol protocol = ExtensionLoader.getExtensionLoader(Protocol.class).getExtension(string);
        return protocol.refer(class_, uRL);
    }
}
```



