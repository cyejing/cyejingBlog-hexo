---
title: Java内存模型和Volatile
tags : [java]
date : 2018-03-04
---
# Java内存模型和Volatile

## 1. 什么是 JMM？

JMM屏蔽掉底层不同平台的差异，在语言层面为程序员提供一个抽象的内存模型，它的核心是一系列关于`指令乱序`的规则，java语言层面上提供的`volatile`和`monitor机制`是其中的两个重点。

有两个方面会导致指令的乱序执行：

1. **编译器重排序**
2. **CPU 重排序**

<!--more-->

## 2. 编译器的重排序

编译器（对 java 而言是 JIT 编译器）在保证 **单线程语义正确** 的前提下，为了优化性能，可以任意对指令重新排序。这对单线程不会产生影响，但在并发环境下就可能导致问题。

### 2.1 Compiler Memory Barrier

在其他未提供统一内存模型的语言中(如C)，需要使用`Compiler Memory Barrier`显式告诉编译器停止重排序：以该Barrier为分割线，Barrier上方的指令不可以重排序到下方，反之亦然。

C中，不同的编译器需要不同的指令：

```
__asm__ __volatile__ ("" ::: "memory"); // GNU
__memory_barrier(); // Intel ECC Compiler
_ReadWriteBarrier(); // Microsoft Visual C++
```

这些指令是针对编译器的，不会对CPU起作用。

### 2.2 JMM 对编译器重排序的规定

JMM在为编译器重排序定义了如下规则（NO表示不可重排序）：

| 1nd \\\ 2nd                   | Normal Load / Normal Store | Volatile Load / Monitor Enter | Volatile Store / Monitor Exit |
| ----------------------------- | -------------------------- | ----------------------------- | ----------------------------- |
| Normal Load / Normal Store    |                            |                               | NO                            |
| Volatile Load / Monitor Enter | NO                         | NO                            | NO                            |
| Volatile store / Monitor Exit |                            | NO                            | NO                            |

> `Monitor Enter` 和 `Monitor Exit` 分别对应 `Sychronized` 块的进入和离开。

简单地说就是在3类地方禁止编译器重排序：

![Alt text](http://novoland.github.io/assets/img/d08f4d58e9f50ecfc929b199829526c4.png)

1. `Volatile 读` & `Sychronized 块的进入` 与 **后续任意读写** 不可重排；
2. `Volatile 写` & `Sychronized 块的离开` 与 **之前任意读写** 不可重排；
3. `Volatile 写` & `Sychronized 块的离开` 与后续 `Volatile 读` & `Sychronized 块的进入` 不可重排。

这几处和后面提到的 CPU指令重排序 是一致的。

## 3. CPU 重排序（`Memory Reordering`）

`Memory Rerdering`指的是在 CPU 在执行程序时， 对内存地址的 `load` 和 `store` 指令 **实际完成的顺序 与 发起指令的顺序 不一致**

### 3.1 为什么会出现`Memory Reordering`？

CPU 为了避免慢速的内存访问拖累指令的执行速度，一个常用的技巧是：将对cache或内存的`load`/`store`指令缓冲至 CPU 内部的 pipeline，对其（异步地）优化后再执行，如重排序(比如先执行命中 cache 的指令，或者将地址相近的指令放在一起执行) / 合并对同一地址的读或写 / 直接从 write buffer 中 load 数据等等，以尽量避免 cache miss，并减少对内存的访问。这是一个生产者消费者模型。

此外，为了充分利用多级流水线，CPU 的 `预测执行 speculative execution` 机制会根据以往的执行情况，在一个判断条件还没得到结果时预先执行概率大的分支并缓存结果，如果条件判断通过则直接使用该中间结果，这也会导致指令的乱序。

![Alt text](http://novoland.github.io/assets/img/fd9868241dc03d1519b75f4ed3ad547b.png)

如图所示，CPU 的执行单元与 cache 之间还存在着各种 buffer，`load store`指令会先进入这些 buffer 中排队。当指令一旦被 `flush` 到 cache ，MESI 缓存一致性协议将保证数据对所有 CPU 可见。

### 3.2 什么情况允许`Memory Reordering`？

CPU 进行 `Memory Reordering` 的前提是保证单线程下语义的正确性，这和编译器重排序遵循的规则是一样的。更进一步的，对于存在`数据依赖性`的指令不允许重排序。

数据依赖分下列三种类型：

1. 写后读 `a = 1;b = a;` 写一个变量之后，再读这个位置。
2. 写后写 `a = 1;a = 2;` 写一个变量之后，再写这个变量。
3. 读后写 `a = b;b = 1;` 读一个变量之后，再写这个变量。

上面三种情况，只要重排序两个操作的执行顺序，程序的执行结果将会被改变。

对于存在`控制依赖性`的代码也可能发生重排序，如：

```
if(ready)
    b = a * a
```

假如对 ready 的 load 发生了 cache miss，为了不阻塞指令执行， CPU 可能会采用`猜测执行`的手段，预先 load a，并计算`a * a`的结果放入 buffer；待 ready 的 load 完成后，如果为 true，再将计算结果取出，执行 b 的 store 动作。

### 3.3 CPU Memory Barrier

CPU 自身只能保证单线程下的serial 的语义，但在并发程序中，我们经常需要 **保证多线程之间内存操作的有序性**，这依赖我们手动在合适的地方插入内存屏障，禁止单线程内某种形式的重排序。

`Load` `Store` 两两组合，一共存在4种乱序，因此对应的有4种 barrier：

1. `LoadLoad`

2. `LoadStore`

3. `StoreStore`

4. `StoreLoad`

   `StoreLoad`乱序可能导致所谓的 **可见性** 问题，对同一个内存地址的访问，某些 CPU 在执行 `Load` 时允许直接从 StoreBuffer 中取其最近一次的 `Store` 返回，显然这可能导致拿到过时的数据；注意，前提是两次指令 **访问同一个地址**。

   当前所有主流 CPU 对 `StoreLoad barrier` 的实现都包括了其他3个 barrier 的效果（这不是必须的，只是现实如此），因此，`StoreLoad barrier` 通常也被当做 `Full Barrier` 使用。

使用标志位是不同的线程间进行通信的一种常见手段，此时需要借助 Memory Barrier 保证多线程间的有序性。一个简单的例子如下：

```
// 初始状态
a = 0;
ready = false;

// Thread 1
a = 1;
ready = true;

// Thread 2
if(ready)
    print a  // 可能打印0
/* 
或者：
c = ready
d = a; 
*/
```

在这个例子中，Thread 1试图用 ready 传递 a 已经被赋值的信号，但是存在两个问题：

1. Thread 1 对 a 和 ready 的`Store`动作有可能`StoreStore`乱序，导致 ready 为 true 时，Thread 2看到的 a 依然是0。因此，在 Thread 1 中必须在 a 和 ready 的store 动作之间插入 `StoreStore barrier`，保证外部在看到 ready 为 true 时，a 必然已被修改；
2. 即使 Thread 1 保证了 Store 有序，Thread 2 依然可能发生 `LoadLoad` 乱序。对 a 的 Load 操作可能发生在 ready 的 Load 之前，因此下面的执行顺序是有可能的：

```
Thread 1                Thread 2
=========               ===========
                            Load a  (0)
a = 1
<StoreStore barrier>
ready = true
                            Load ready (true)
                            判断通过
                            print a
```

因此，在 Thread 2 中必须用`LoadLoad barrier`保证 a 和 ready 两个 Load 动作的顺序性。

由此可见，内存屏障 **只能保证执行该屏障的 CPU 的内存顺序性**，如果两个线程依赖读写某些相同变量进行通信，只在某一端使用屏障是不够的，另一端也必须根据自己的逻辑加上对应的内存屏障。

### 3.4 硬件内存模型

`Memory Model`指定了 CPU 允许哪些指令重排序的发生，越多，内存一致性越弱；越少，内存一致性就越强。

![Alt text](http://novoland.github.io/assets/img/3f85cd91f478831a157afc5179bccf2b.png)

常见的 x86 平台只允许 `StoreLoad` 乱序，因此它的内存模型属于强一致性。

不同平台上这四种 memory barrier 对应的指令如下，其中 x86 因为只支持`StoreLoad`乱序，所以只提供了`StoreLoad Barrier (亦即Full Barrier)`: 
![Alt text](http://novoland.github.io/assets/img/aaddce10fc3455e3fdc05bca8e83ff62.png)

### 3.5 `Read-Acquire barrier` 和 `Write-Release barrier`

在实际应用中，4种按乱序情况的分法太细粒度了，`Read-Acquire barrier` 、 `Write-Release barrier` 是一种更粗粒度，也更常用的分类方式；

![Alt text](http://novoland.github.io/assets/img/41491455e62a0c75bf08d2d5c155ddc3.png)

即：

- Read-Acquire = LoadLoad + LoadStore;
- Write-Release = LoadStore + StoreStore.

`Read-Acquire` 
具有 Read-Acquire 语义的 Read 操作保证，所有后续的读写只有在该 Read 执行完毕后才能执行。

`Write-Release` 
具有 Write-Release 语义的 Write 操作保证，只有之前的所有读写都已经执行完毕，该 write 才能执行。

`Read-Acquire barrier` 和 `Write-Release barrier` 总是成对使用的，**保证不同线程间对内存操作的顺序性**：

![Alt text](http://novoland.github.io/assets/img/43fe44f8dfcd17efb0a19880fd8d7c2d.png)

还是举上面的例子，用`Read-Acquire`和`Write-Release` barrier 的方式如下：

```
// 初始状态
a = 0;
ready = false;

// Thread 1
a = 1;
write_release_barrier();
ready = true;

// Thread 2
if(ready){
    read_acquire_barrier();    
    print a
}
```

此时，我们 **为 ready 这个变量赋予了 Read-Acquire 和 Write-Release 语义**，对它的读或写动作与前后的其他 load/store 动作确立了先后关系. 当 Thread 2 发现 ready 为 true 时，a 的 store 必然已经完成，必然为1; 而 a 的 load 也不会比 ready 的 load 先完成.

`Read-Acquire` 和 `Write-Release` 语义也被广泛应用在锁的实现中，**加锁 和 释放锁 分别附带了Read-Acquire 和Write-Release 语义，保证了 加锁 --> load/store 和 load/store --> 释放锁 这两个指令序列之间的偏序关系**，这样当某个线程获取了锁时，它可以确信前一个线程在释放锁之前所做的操作已经全部完成了。

接下来会看到，`Read-Acquire` 和 `Write-Release` 是 JMM 的核心。

### 3.6 JMM 对 CPU Memory Reordering 的规则

JMM 定义了单线程内必须遵循如下重排序规则：

| NormalLoad                  | NormalStore | VolatileLoad / MonitorEnter | VolatileStore / MonitorExit |
| --------------------------- | ----------- | --------------------------- | --------------------------- |
| NormalLoad                  |             |                             |                             |
| NomalStore                  |             |                             |                             |
| VolatileLoad / MonitorEnter | LoadLoad    | LoadStore                   | LoadLoad                    |
| VolatileStore / MonitorExit |             |                             | `StoreLoad`                 |

看上去很复杂，但其实只有两点：

1. ** Volatile 变量 / Monitor具有 Read-Acquire & Write-Release 语义； \**

   第三行即 `Read-Acquire`，最后一列即 `Write-Release`；

2. ** 在任意两个 Volatile 变量 / Monitor 的 Store->Load / Exit->Enter 操作中间必须插入一个 StoreLoad barrier 禁止重排序; 这同时也解决了单个 volatile 变量 / Monitor 可能出现的可见性问题 。\**

   可见性问题已经在3.3描述过了.

![Alt text](http://novoland.github.io/assets/img/76c4cf48eb5fc3fc8f6dde0593ee85ef.png)

JMM cookbook 中提到了一种可能的实现。编译器很多时候无法知道确切的`Load` / `Store` 指令顺序，比如在一个方法 return 之前对一个 Volatile 变量 write 了，因此一个策略是采取悲观策略，在每个可能需要禁止某种重排序的地方都加上对应的 barrier：

1. 在每个 `Volatile Read / Monitor Enter` 后加上 `LoadLoad` & `LoadStore` barrier，亦即 `Read-Acquire`barrier;
2. 在每个 `Volatile Write / Monitor Exit` 前加上 `StoreStore` & `LoadStore` barrier，亦即 `Write-Release`barrier;
3. 在每个 `Volatile Write / Monitor Exit` 后加上 `StoreLoad` barrier（也可以在每次 Read 前加上，但 Write 出现的几率显然要低的多）。

当然，编译器会做许多别的优化，比如合并 barrier 之类的，而且很大一部分的 barrier 对应到硬件指令时是空操作。

这个策略在 openjdk 的 C1 编译器[ (c1_LIRGenerator.cpp) ](https://www.evernote.com/OutboundRedirect.action?dest=https%3A%2F%2Fcode.google.com%2Fp%2Fneedle%2Fsource%2Fbrowse%2Fsrc%2Fshare%2Fvm%2Fc1%2Fc1_LIRGenerator.cpp%3Fr%3D2f644f85485d7460dea5edb5f6c8716093e66a44)中得到了印证：

```
//------------------------field access--------------------------------------

// Comment copied form templateTable_i486.cpp
// ----------------------------------------------------------------------------
// Volatile variables demand their effects be made known to all CPU's in
// order.  Store buffers on most chips allow reads & writes to reorder; the
// JMM's ReadAfterWrite.java test fails in -Xint mode without some kind of
// memory barrier (i.e., it's not sufficient that the interpreter does not
// reorder volatile references, the hardware also must not reorder them).
//
// According to the new Java Memory Model (JMM):
// (1) All volatiles are serialized wrt to each other.
// ALSO reads & writes act as aquire & release, so:
// (2) A read cannot let unrelated NON-volatile memory refs that happen after
// the read float up to before the read.  It's OK for non-volatile memory refs
// that happen before the volatile read to float down below it.
// (3) Similar a volatile write cannot let unrelated NON-volatile memory refs
// that happen BEFORE the write float down to after the write.  It's OK for
// non-volatile memory refs that happen after the volatile write to float up
// before it.
//
// We only put in barriers around volatile refs (they are expensive), not
// _between_ memory refs (that would require us to track the flavor of the
// previous memory refs).  Requirements (2) and (3) require some barriers
// before volatile stores and after volatile loads.  These nearly cover
// requirement (1) but miss the volatile-store-volatile-load case.  This final
// case is placed after volatile-stores although it could just as well go
// before volatile-loads.

// volatile store
void LIRGenerator::do_StoreField(StoreField* x) {
    // Write-Release barrier
    if (is_volatile && os::is_MP()) {
        __ membar_release();
    }

    // Store
    ...
    volatile_field_store(value.result(), address, info);
    ...

    // StoreLoad barrier，这里直接写作 membar 的原因是大部分平台上 storeload barrier 被实现为一个 full barrier
    if (is_volatile && os::is_MP()) {
        __ membar();
    }
}

// volatile load
void LIRGenerator::do_LoadField(LoadField* x) {
    // Load
    ...
    volatile_field_load(address, reg, info);
    ...

    // Read-Acquire barrier
    if (is_volatile && os::is_MP()) {
        __ membar_acquire();
    }
}

```

## 3. JMM的其他方面

1. **原子性**，JMM 规定基本类型的 load/store 必须是原子的；
2. `Volatile` 变量不允许使用寄存器分配。
3. final 变量??

## 4. 总结

1. `volatile`的作用：**保证线程A的内存操作被线程B观察时，是有序的**。单线程内，编译器、CPU会出于各种原因乱序*完成*指令，虽然本线程内的逻辑依然是正确的，但外部线程观察到的指令生效的顺序不可保证，`volatile`就是解决这个问题的。
2. 什么时候用`volatile`? – 当一个变量被多线程访问, 且会被其中某些线程 write 时, 用`volatile`.

## 5. 参考资料

1. [The JSR-133 Cookbook](http://gee.cs.oswego.edu/dl/jmm/cookbook.html)
2. 何登成的《CPU Cache and Memory Ordering.ppt》
3. [无锁化编程](http://docs.google.com/presentation/d/1JkOUQ07nr0WQ8SKqcWA5D3M0v1gUdAwgNBbUcMhhGis/preview?usp=sharing&sle=true#slide=id.p)
4. [Acquire and Release Semantics](http://preshing.com/20120913/acquire-and-release-semantics)
5. [Memory Ordering at Compile Time](http://preshing.com/20120625/memory-ordering-at-compile-time/)
6. [Memory Barriers/Fences](http://ifeve.com/memory-barriersfences/)
7. [Java Memory Model Under The Hood](http://gvsmirnov.ru/blog/tech/2014/02/10/jmm-under-the-hood.html#printassembly-fun)
8. [Memory Ordering in Modern Microprocessors, Part II](http://www.linuxjournal.com/article/8212)
9. [CPU Cache Flushing Fallacy](http://ifeve.com/cpu-cache-flushing-fallacy-cn/)
10. [Weak vs. Strong Memory Models](http://preshing.com/20120930/weak-vs-strong-memory-models/)
11. [深入理解Java内存模型](http://www.infoq.c/java-memory-model-1) 系列文章

------

附：`StoreLoad` 乱序导致 `Peterson 算法` 失效 
这不属于通用问题，而是依赖代码的逻辑。