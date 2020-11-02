---
title : Netty源码解析-ByteBufAllocator解析
tags : [Netty]
date: 2020-10.30
---

## ByteBufAllocator解析


{% asset_img image-20201030162224718.png %}

内存分配器具体有两个实现PooledByteBufAllocator池化和UnpooledByteBufAllocator非池化。

ByteBufAllocator接口有以下方法去创建ByteBuf


{% asset_img image-20201030162805553.png %}



## UnpooledByteBufAllocator解析

```java
// UnpooledByteBufAllocator
@Override
protected ByteBuf newDirectBuffer(int initialCapacity, int maxCapacity) {
  final ByteBuf buf;
  if (PlatformDependent.hasUnsafe()) {
    buf = noCleaner ? new InstrumentedUnpooledUnsafeNoCleanerDirectByteBuf(this, initialCapacity, maxCapacity) :
    new InstrumentedUnpooledUnsafeDirectByteBuf(this, initialCapacity, maxCapacity);
  } else {
    buf = new InstrumentedUnpooledDirectByteBuf(this, initialCapacity, maxCapacity);
  }
  return disableLeakDetector ? buf : toLeakAwareBuffer(buf);
}

@Override
protected ByteBuf newHeapBuffer(int initialCapacity, int maxCapacity) {
  return PlatformDependent.hasUnsafe() ?
    new InstrumentedUnpooledUnsafeHeapByteBuf(this, initialCapacity, maxCapacity) :
  new InstrumentedUnpooledHeapByteBuf(this, initialCapacity, maxCapacity);
}
```

非池化非常简单，内部就是new新的对象，主要判断是否有unsafe类可以使用

## PooledByteBufAllocator解析

```java
//PooledByteBufAllocator
@Override
protected ByteBuf newHeapBuffer(int initialCapacity, int maxCapacity) {
  // 通过ThreadLocal获取cache
  PoolThreadCache cache = threadCache.get();
  // cache里面有byteBuf缓存池
  PoolArena<byte[]> heapArena = cache.heapArena;

  final ByteBuf buf;
  if (heapArena != null) {
    // 通过缓存池获取对应大小的内存块
    buf = heapArena.allocate(cache, initialCapacity, maxCapacity);
  } else {
    // 缓存池没有初始化？ 使用非池化
    buf = PlatformDependent.hasUnsafe() ?
      new UnpooledUnsafeHeapByteBuf(this, initialCapacity, maxCapacity) :
    new UnpooledHeapByteBuf(this, initialCapacity, maxCapacity);
  }

  return toLeakAwareBuffer(buf);
}

@Override
protected ByteBuf newDirectBuffer(int initialCapacity, int maxCapacity) {
  // 通过ThreadLocal获取cache
  PoolThreadCache cache = threadCache.get();
  // cache里面有byteBuf缓存池
  PoolArena<ByteBuffer> directArena = cache.directArena;

  final ByteBuf buf;
  if (directArena != null) {
    // 通过缓存池获取对应大小的内存块
    buf = directArena.allocate(cache, initialCapacity, maxCapacity);
  } else {
    // 缓存池没有初始化？ 使用非池化
    buf = PlatformDependent.hasUnsafe() ?
      UnsafeByteBufUtil.newUnsafeDirectByteBuf(this, initialCapacity, maxCapacity) :
    new UnpooledDirectByteBuf(this, initialCapacity, maxCapacity);
  }

  return toLeakAwareBuffer(buf);
}

```

内部采用Jemalloc算法进行内存分配，减少内存碎片化。



> Jemalloc https://www.jianshu.com/p/15304cd63175
>
> PollArena https://www.jianshu.com/p/86fbacdb68bd
