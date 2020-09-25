---
title : DirectByteBuffer解析
tags : [netty,java,directByteBuffer]
date: 2020-09-25
---


# DirectByteBuffer

### 堆外内存创建和释放逻辑

```java
// Primary constructor
// 常规的构造函数
DirectByteBuffer(int cap) {                   // package-private

  super(-1, 0, cap, cap);
  boolean pa = VM.isDirectMemoryPageAligned();
  int ps = Bits.pageSize();
  long size = Math.max(1L, (long)cap + (pa ? ps : 0));
  // 预申请cap容量的堆外内存
  Bits.reserveMemory(size, cap);

  long base = 0;
  try {
    // 分配堆外内存，返回地址
    base = unsafe.allocateMemory(size);
  } catch (OutOfMemoryError x) {
    Bits.unreserveMemory(size, cap);
    throw x;
  }
  //内存初始化
  unsafe.setMemory(base, size, (byte) 0);
  if (pa && (base % ps != 0)) {
    // Round up to page boundary
    address = base + ps - (base & (ps - 1));
  } else {
    address = base;
  }
  //创建Cleaner对象，当DirectByteBuffer被回收的时候，跟踪队列信息调用clean方法释放堆外内存（使用虚引用PhantomReference，通常PhantomReference与引用队列ReferenceQueue结合使用，可以实现虚引用关联对象被垃圾回收时能够进行系统通知、资源清理等功能）
  cleaner = Cleaner.create(this, new Deallocator(base, size, cap));
  att = null;
}

//Bits.reserveMemory
// These methods should be called whenever direct memory is allocated or
// freed.  They allow the user to control the amount of direct memory
// which a process may access.  All sizes are specified in bytes.
static void reserveMemory(long size, int cap) {

  if (!memoryLimitSet && VM.isBooted()) {
    maxMemory = VM.maxDirectMemory();
    memoryLimitSet = true;
  }

  // optimist!
  //尝试获取cap容量的内存
  if (tryReserveMemory(size, cap)) {
    return;
  }

  final JavaLangRefAccess jlra = SharedSecrets.getJavaLangRefAccess();

  // retry while helping enqueue pending Reference objects
  // which includes executing pending Cleaner(s) which includes
  // Cleaner(s) that free direct buffer memory
  // 当内存不足的时候，处理待回收Reference队列的引用，触发到Cleaner回收堆外内存
  while (jlra.tryHandlePendingReference()) {
    if (tryReserveMemory(size, cap)) {
      return;
    }
  }

  // trigger VM's Reference processing
  // 当上面的尝试还是不足，触发FullGc
  System.gc();

  // a retry loop with exponential back-off delays
  // (this gives VM some time to do it's job)
  boolean interrupted = false;
  try {
    long sleepTime = 1;
    int sleeps = 0;
    //休眠并循环的去等待内存是否足够
    while (true) {
      if (tryReserveMemory(size, cap)) {
        return;
      }
      if (sleeps >= MAX_SLEEPS) {
        break;
      }
      if (!jlra.tryHandlePendingReference()) {
        try {
          Thread.sleep(sleepTime);
          sleepTime <<= 1;
          sleeps++;
        } catch (InterruptedException e) {
          interrupted = true;
        }
      }
    }

    // no luck
    // 非常不幸，内存还是不足
    throw new OutOfMemoryError("Direct buffer memory");

  } finally {
    if (interrupted) {
      // don't swallow interrupts
      Thread.currentThread().interrupt();
    }
  }
}
```

上面代码就是jdk实现的堆外内存申请和释放的逻辑
<!--more-->


### Netty对堆外内存有NoCleaner的实现

```java
// UnpooledByteBufAllocator
@Override
protected ByteBuf newDirectBuffer(int initialCapacity, int maxCapacity) {
  final ByteBuf buf;
  //是否有unsafe
  if (PlatformDependent.hasUnsafe()) {
    // 是否有Cleaner
    buf = noCleaner ? new InstrumentedUnpooledUnsafeNoCleanerDirectByteBuf(this, initialCapacity, maxCapacity) :
    new InstrumentedUnpooledUnsafeDirectByteBuf(this, initialCapacity, maxCapacity);
  } else {
    buf = new InstrumentedUnpooledDirectByteBuf(this, initialCapacity, maxCapacity);
  }
  return disableLeakDetector ? buf : toLeakAwareBuffer(buf);
}

//PlatformDependent
public static ByteBuffer allocateDirectNoCleaner(int capacity) {
  assert USE_DIRECT_BUFFER_NO_CLEANER;

  incrementMemoryCounter(capacity);
  try {
    return PlatformDependent0.allocateDirectNoCleaner(capacity);
  } catch (Throwable e) {
    decrementMemoryCounter(capacity);
    throwException(e);
    return null;
  }
}


private static void incrementMemoryCounter(int capacity) {
  if (DIRECT_MEMORY_COUNTER != null) {
    for (;;) {
      long usedMemory = DIRECT_MEMORY_COUNTER.get();
      long newUsedMemory = usedMemory + capacity;
      // 增加内存，如果不足直接抛出异常，相比DirectByteBuffer简单粗暴
      if (newUsedMemory > DIRECT_MEMORY_LIMIT) {
        throw new OutOfDirectMemoryError("failed to allocate " + capacity
                                         + " byte(s) of direct memory (used: " + usedMemory + ", max: " + DIRECT_MEMORY_LIMIT + ')');
      }
      if (DIRECT_MEMORY_COUNTER.compareAndSet(usedMemory, newUsedMemory)) {
        break;
      }
    }
  }
}


static ByteBuffer newDirectBuffer(long address, int capacity) {
  ObjectUtil.checkPositiveOrZero(capacity, "capacity");

  try {
    // 利用反射调用DirectByteBuffer的私有构造方法
    return (ByteBuffer) DIRECT_BUFFER_CONSTRUCTOR.newInstance(address, capacity);
  } catch (Throwable cause) {
    // Not expected to ever throw!
    if (cause instanceof Error) {
      throw (Error) cause;
    }
    throw new Error(cause);
  }
}

```

没有了Cleaner堆外内存该怎么回收呢？ReferenceCountUtil.release()使用Netty不能忘记的这个步骤，就是释放内存的步骤，此外ResourceLeakDetector也做了内存泄露的诊断，如果存在泄露的风险会有日志告警

