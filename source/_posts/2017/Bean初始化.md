---
title: Bean的加载流程概览
tags : [Spring,Java]
date : 2017-06-16
---

下面有很简单的一段代码可以作为Spring代码加载的入口：

```
 1 ApplicationContext ac = new ClassPathXmlApplicationContext("spring.xml");
 2 ac.getBean(XXX.class);
```

ClassPathXmlApplicationContext用于加载CLASSPATH下的Spring配置文件

以下是继承的类图

{% asset_img applicationContext.png %}

加载的主要流程: AbstractApplicationContext.refresh()

<!--more-->

```java
public void refresh() throws BeansException, IllegalStateException {
		synchronized (this.startupShutdownMonitor) {
			// Prepare this context for refreshing.
			prepareRefresh();

			// Tell the subclass to refresh the internal bean factory.
			ConfigurableListableBeanFactory beanFactory = obtainFreshBeanFactory();

			// Prepare the bean factory for use in this context.
			prepareBeanFactory(beanFactory);

			try {
				// Allows post-processing of the bean factory in context subclasses.
				postProcessBeanFactory(beanFactory);

				// Invoke factory processors registered as beans in the context.
				invokeBeanFactoryPostProcessors(beanFactory);

				// Register bean processors that intercept bean creation.
				registerBeanPostProcessors(beanFactory);

				// Initialize message source for this context.
				initMessageSource();

				// Initialize event multicaster for this context.
				initApplicationEventMulticaster();

				// Initialize other special beans in specific context subclasses.
				onRefresh();

				// Check for listener beans and register them.
				registerListeners();

				// Instantiate all remaining (non-lazy-init) singletons.
				finishBeanFactoryInitialization(beanFactory);

				// Last step: publish corresponding event.
				finishRefresh();
			}

			catch (BeansException ex) {
				// Destroy already created singletons to avoid dangling resources.
				destroyBeans();
				// Reset 'active' flag.
				cancelRefresh(ex);
				// Propagate exception to caller.
				throw ex;
			}
			finally {
				// Reset common introspection caches in Spring's core, since we
				// might not ever need metadata for singleton beans anymore...
				resetCommonCaches();
			}
		}
	}
```





**ClassPathXmlApplicationContext存储内容**

为了更理解ApplicationContext，拿一个实例ClassPathXmlApplicationContext举例，看一下里面存储的内容，加深对ApplicationContext的认识，以表格形式展现：

| **对象名**                     | **类  型**                       | **作  用**                                 | **归属类**                                  |
| --------------------------- | ------------------------------ | ---------------------------------------- | ---------------------------------------- |
| configResources             | Resource[]                     | 配置文件资源对象数组                               | ClassPathXmlApplicationContext           |
| configLocations             | String[]                       | 配置文件字符串数组，存储配置文件路径                       | AbstractRefreshableConfigApplicationContext |
| beanFactory                 | DefaultListableBeanFactory     | 上下文使用的Bean工厂                             | AbstractRefreshableApplicationContext    |
| beanFactoryMonitor          | Object                         | Bean工厂使用的同步监视器                           | AbstractRefreshableApplicationContext    |
| id                          | String                         | 上下文使用的唯一Id，标识此ApplicationContext         | AbstractApplicationContext               |
| parent                      | ApplicationContext             | 父级ApplicationContext                     | AbstractApplicationContext               |
| beanFactoryPostProcessors   | List<BeanFactoryPostProcessor> | 存储BeanFactoryPostProcessor接口，Spring提供的一个扩展点 | AbstractApplicationContext               |
| startupShutdownMonitor      | Object                         | refresh方法和destory方法公用的一个监视器，避免两个方法同时执行   | AbstractApplicationContext               |
| shutdownHook                | Thread                         | Spring提供的一个钩子，JVM停止执行时会运行Thread里面的方法     | AbstractApplicationContext               |
| resourcePatternResolver     | ResourcePatternResolver        | 上下文使用的资源格式解析器                            | AbstractApplicationContext               |
| lifecycleProcessor          | LifecycleProcessor             | 用于管理Bean生命周期的生命周期处理器接口                   | AbstractApplicationContext               |
| messageSource               | MessageSource                  | 用于实现国际化的一个接口                             | AbstractApplicationContext               |
| applicationEventMulticaster | ApplicationEventMulticaster    | Spring提供的事件管理机制中的事件多播器接口                 | AbstractApplicationContext               |
| applicationListeners        | Set<ApplicationListener>       | Spring提供的事件管理机制中的应用监听器                   | AbstractApplicationContext               |

 

为了更清晰地说明DefaultListableBeanFactory的作用，列举一下DefaultListableBeanFactory中存储的一些重要对象及对象中的内容，DefaultListableBeanFactory基本就是操作这些对象，以表格形式说明：

| **对象名**                       | **类  型**                        | ** 作    用**                         | **归属类**                            |
| ----------------------------- | ------------------------------- | ----------------------------------- | ---------------------------------- |
| aliasMap                      | Map<String, String>             | 存储Bean名称->Bean别名映射关系                | SimpleAliasRegistry                |
| **singletonObjects **         | **Map<String, Object>**         | ** 存储单例Bean名称->单例Bean实现映射关系**       | **DefaultSingletonBeanRegistry **  |
| singletonFactories            | Map<String, ObjectFactory>      | 存储Bean名称->ObjectFactory实现映射关系       | DefaultSingletonBeanRegistry       |
| earlySingletonObjects         | Map<String, Object>             | 存储Bean名称->预加载Bean实现映射关系             | DefaultSingletonBeanRegistry       |
| registeredSingletons          | Set<String>                     | 存储注册过的Bean名                         | DefaultSingletonBeanRegistry       |
| singletonsCurrentlyInCreation | Set<String>                     | 存储当前正在创建的Bean名                      | DefaultSingletonBeanRegistry       |
| disposableBeans               | Map<String, Object>             | 存储Bean名称->Disposable接口实现Bean实现映射关系  | DefaultSingletonBeanRegistry       |
| factoryBeanObjectCache        | Map<String, Object>             | 存储Bean名称->FactoryBean接口Bean实现映射关系   | FactoryBeanRegistrySupport         |
| propertyEditorRegistrars      | Set<PropertyEditorRegistrar>    | 存储PropertyEditorRegistrar接口实现集合     | AbstractBeanFactory                |
| embeddedValueResolvers        | List<StringValueResolver>       | 存储StringValueResolver（字符串解析器）接口实现列表 | AbstractBeanFactory                |
| beanPostProcessors            | List<BeanPostProcessor>         | 存储 BeanPostProcessor接口实现列表          | AbstractBeanFactory                |
| mergedBeanDefinitions         | Map<String, RootBeanDefinition> | 存储Bean名称->合并过的根Bean定义映射关系           | AbstractBeanFactory                |
| alreadyCreated                | Set<String>                     | 存储至少被创建过一次的Bean名集合                  | AbstractBeanFactory                |
| ignoredDependencyInterfaces   | Set<Class>                      | 存储不自动装配的接口Class对象集合                 | AbstractAutowireCapableBeanFactory |
| resolvableDependencies        | Map<Class, Object>              | 存储修正过的依赖映射关系                        | DefaultListableBeanFactory         |
| beanDefinitionMap             | Map<String, BeanDefinition>     | 存储Bean名称-->Bean定义映射关系               | DefaultListableBeanFactory         |
| beanDefinitionNames           | List<String>                    | 存储Bean定义名称列表                        | DefaultListableBeanFactory         |

