---
title: ClassPathXmlApplicationContext加载过程
tags : [Spring,Java]
date : 2017-07-08
---



### ClassPathXmlApplicationContext加载过程

当我们执行``new ClassPathXmlApplicationContext()`` 时执行的过程:

1. [ClassPathXmlApplicationContext.refresh()][ClassPathXmlApplication#L136]构造函数
2. [AbstractApplicationContext.refresh()][AbstractApplicationContext#L518]主要加载方法
3. [AbstractApplicationContext.prepareRefresh()][AbstractApplicationContext.java#L517]主要扫描xml文件
4. [AbstractApplicationContext.obtainFreshBeanFactory()][AbstractApplicationContext.java#L618]主要扫描xml加载bean的相关信息到``BeanFactory``里面
5. [AbstractRefreshableApplicationContext.refreshBeanFactory()][]这里创建``DefaultListableBeanFactory``,并且调用[AbstractRefreshableApplicationContext.customizeBeanFactory()][],[AbstractXmlApplicationContext.loadBeanDefinitions()][]去加载bean的相关信息,这个时候生成的bean为``BeanDifinition``,默认实现类``GenericBeandefinition`` 
6. ``XmlBeanDefinitionReader``是读取xml的主要类;
7. ``BeanFactory``加载完``BeanDefinition``后就结束了,在getBean时才去初始化bean,而ApplicationContext会在接下来的生命流程去初始化``BeanDefinition``
8. [AbstractApplicationContext.prepareBeanFactory()][AbstractApplicationContext.java#L523] 准备环境变量,初始化一下BeanFactory需要的类
9. [AbstractApplicationContext.invokeBeanFactoryPostProcessors()][AbstractApplicationContext.java#L530] 执行BeanFactory加工器,只是BeanFactory主要的拓展点,可以对BeanFactory的内容进行特殊加工
10. [AbstractApplicationContext.registerBeanPostProcessors][AbstractApplicationContext.java#L533] 注册Bean加工器,用于在Bean实例化前后进行调用,这个是Bean的主要拓展点,可以对实例化的Bean进行加工
11. ``initMessageSource()``初始化国际化信息
12. ``initApplicationEventMulticaster()``初始化上下文事件广播器
13. ``onRefresh()``模板方法提供给子类进行拓展
14. ``registerListeners()``向广播器注册监听器
15. [AbstractApplicationContext.finishBeanFactoryInitialization()][AbstractApplicationContext.java#L839] 对BeanFactory中的Bean进行实例化(非懒加载的Bean)
16. [DefaultListableBeanFactory.preInstantiateSingletons()][DefaultListableBeanFactory.java#L728] 循环调用BeanFactory的getBean()方法,进行Bean的实例化


<!--more-->

### 后记

再看AbstractApplicationContext的refresh方法，从中读到了很多细节：

- Spring默认加载的两个Bean，systemProperties和systemEnvironment，分别用于获取环境信息、系统信息


- BeanFactoryPostProcessor接口用于在所有Bean实例化之前调用一次postProcessBeanFactory
- 可以通过实现PriorityOrder、Order接口控制BeanFactoryPostProcessor调用顺序
- 可以通过实现PriorityOrder、Order接口控制BeanPostProcessor调用顺序
- 默认的MessageSource，名为"messageSource"
- 默认的ApplicationEventMulticaster，名为"applicationEventMulticaster"
- 默认的LifecycleProcessor，名为"lifecycleProcessor"

除了这些，在整个refresh方法里还隐藏了许多细节，这里就不一一罗列了，多读源码，会帮助我们更好地使用Spring。




[AbstractApplicationContext.java#L523]:  $link$org/springframework/context/support/AbstractApplicationContext.java#L523
[DefaultListableBeanFactory.java#L728]:  $link$org/springframework/beans/factory/support/DefaultListableBeanFactory.java#L728
[AbstractApplicationContext.java#L839]:  $link$org/springframework/context/support/AbstractApplicationContext.java#L839
[AbstractApplicationContext.java#L530]:  $link$org/springframework/context/support/PostProcessorRegistrationDelegate.java#L52
[AbstractApplicationContext.java#L533]:  $link$org/springframework/context/support/PostProcessorRegistrationDelegate.java#L183
[ClassPathXmlApplication#L136]: https://github.com/cyejing/spring-framework-yj/blob/master/spring-context/src/main/java/org/springframework/context/support/ClassPathXmlApplicationContext.java#L136
[AbstractApplicationContext#L518]: https://github.com/cyejing/spring-framework-yj/blob/master/spring-context/src/main/java/org/springframework/context/support/AbstractApplicationContext.java#L514
[AbstractApplicationContext.java#L517]: https://github.com/cyejing/spring-framework-yj/blob/master/spring-context/src/main/java/org/springframework/context/support/AbstractApplicationContext.java#L517
[AbstractApplicationContext.java#L618]: https://github.com/cyejing/spring-framework-yj/blob/master/spring-context/src/main/java/org/springframework/context/support/AbstractApplicationContext.java#L618
[AbstractRefreshableApplicationContext.refreshBeanFactory()]: https://github.com/cyejing/spring-framework-yj/blob/master/spring-context/src/main/java/org/springframework/context/support/AbstractRefreshableApplicationContext.java#L120
[AbstractRefreshableApplicationContext.customizeBeanFactory()]: https://github.com/cyejing/spring-framework-yj/blob/master/spring-context/src/main/java/org/springframework/context/support/AbstractRefreshableApplicationContext.java#L217
[AbstractXmlApplicationContext.loadBeanDefinitions()]: https://github.com/cyejing/spring-framework-yj/blob/master/spring-context/src/main/java/org/springframework/context/support/AbstractXmlApplicationContext.java#L80



