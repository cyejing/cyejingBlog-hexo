---
title : Netty源码解析-FastThreadLocal解析
tags : [netty]
date: 2020-07-10
---
# FastThreadLocal解析

顾名思义比JDK的ThreadLocal快。

JDK 的ThreadLocal使用线性探测法的Map当hash冲突时需要变量找到对应的对象，FastThreadLocal使用递增的数组下标去访问存储的对象，存取会非常的快，缺点就是空间会有一定的浪费。

下面看源码
<!--more-->
#### 构造函数

每新建一个FastThreadLocal都会递增一个index

   ```java
   //	FastThreadLocal
   public FastThreadLocal() {
     index = InternalThreadLocalMap.nextVariableIndex();
   }
   ```

   ```java
   //	InternalThreadLocalMap
   static final AtomicInteger nextIndex = new AtomicInteger();
    
   public static int nextVariableIndex() {
     int index = nextIndex.getAndIncrement();
     if (index < 0) {
       nextIndex.decrementAndGet();
       throw new IllegalStateException("too many thread-local indexed variables");
     }
     return index;
   }
   ```

#### get方法

   ```java
   //	InternalThreadLocalMap
   public final V get() {
     //获取内部保存的Map
     InternalThreadLocalMap threadLocalMap = InternalThreadLocalMap.get();
     //根据索引取Map的位置
     Object v = threadLocalMap.indexedVariable(index);
     if (v != InternalThreadLocalMap.UNSET) {
       return (V) v;
     }
   
     return initialize(threadLocalMap);
   }
   //初始化对应的值
   private V initialize(InternalThreadLocalMap threadLocalMap) {
     V v = null;
     try {
       v = initialValue();
     } catch (Exception e) {
       PlatformDependent.throwException(e);
     }
   
     threadLocalMap.setIndexedVariable(index, v);
     addToVariablesToRemove(threadLocalMap, this);
     return v;
   }
   ```

#### InternalThreadLocalMap的get方法

   ```java
   //InternalThreadLocalMap
   Object[] indexedVariables;
   public static InternalThreadLocalMap get() {
     	//获取当前线程
       Thread thread = Thread.currentThread();
       if (thread instanceof FastThreadLocalThread) {
         	//如果是netty的Fast线程直接从Thread变量里面获取
           return fastGet((FastThreadLocalThread) thread);
       } else {
         	//如果不是则从JDK的ThreadLocal里面获取
           return slowGet();
       }
   }
   //根据变量从数组里面获取值
   public Object indexedVariable(int index) {
     Object[] lookup = indexedVariables;
     return index < lookup.length? lookup[index] : UNSET;
   }
   ```

#### 总结

每个Thread对应一个InternalThreadLocalMap，每个InternalThreadLocalMap对应一个Object[].

每个FastThreadLocal都有一个index变量，数据的存取就是 Object[index].

疑点``nextIndex``是个静态变量会不断的往上递增，那每个Thread的Object[]空间会有很大部分都是空的。这是不是造成很多空间的浪费。

