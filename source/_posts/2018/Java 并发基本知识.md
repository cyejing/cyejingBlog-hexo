---
title: Java 并发基本知识
tags : [java]
date : 2018-03-04
---
# Java 并发基本知识

- Java 并发基本知识
  - [1. 为什么要多线程？]()
  - [2. 线程基本操作]()
  - [3. 线程的状态及分析]()
  - [4. 线程中断]()
  - [5. 互斥和协作]()
  - [6. 死锁的4个必要条件]()
  - [7. 常见的锁优化方法]()

## 1. 为什么要多线程？

1. 利用多核CPU；
2. 利用阻塞时的空闲CPU资源，`线程数 ≈ (运行时间 + 阻塞时间) / 运行时间`；
3. 均分计算资源，让多个任务能同时推进，而不是只服务一个客户。

<!--more-->

## 2. 线程基本操作

1. 两种创建线程的方法：

   - 继承`Thread`类，重写`run()`；
   - 创建一个任务（`Runnable接口`），再创建一个`Thread`对象驱动它。

   通过`Thread#start()`启动线程。

2. `Thread.yield()`，出让CPU资源，让给别的线程。只是个提示；

3. `Thread#setDaemon(true)`，守护线程，所有的非守护线程退出时程序结束，即使还有守护线程；

4. `Thread#join()`，等待该线程完成，在那之前当前线程阻塞；

5. `Thread#setUncaughtExceptionHandler(...)`，给线程安装异常处理器，处理线程运行时抛出的异常；

## 3. 线程的状态及分析

线程的状态如下，其中绿色的4个状态对应java中`Thread.State`枚举类型的4个值。运行中线程的状态也是`runnable`：

![Alt text](http://novoland.github.io/assets/img/d6c78c27079e697610a7b12e0b3faa42.png)

用jdk自带工具`jstack`可以查看JVM内部线程的当前所处状态，及方法的调用栈。线程持有的锁 / 正在等待的锁 / 正在哪个对象上wait等信息也会被打印出来，这对排查死锁问题很有帮助：

```
$ jstack 31207 # pid
...
"t4" prio=10 tid=0x6dc53800 nid=0x79fa in Object.wait() [0x6daa5000]
   java.lang.Thread.State: WAITING (on object monitor) # <-- state
    at java.lang.Object.wait(Native Method)            # <-- stacktrace
    - waiting on <0x9ef2b8c8> (a java.lang.Thread)     # <-- 在哪个对象上wait
    at java.lang.Thread.join(Thread.java:1260)
    - locked <0x9ef2b8c8> (a java.lang.Thread)         # <-- 持有的lock
    at java.lang.Thread.join(Thread.java:1334)
    at ThreadStateTest$4.run(ThreadStateTest.java:53)
    at java.lang.Thread.run(Thread.java:724)
...
```

以下3种状态的线程均为 `Runnable`：

1. 正在执行中；
2. 可以执行，在等待CPU时间片；
3. **在IO资源上等待，如阻塞在socket.read()上**。

尤其要注意第三点，IO阻塞的线程在jstack里的输出也是`Runnable`的。

阻塞状态不涉及进程外的阻塞（如IO阻塞），只描述JVM内部并发/主动休眠等原因导致的线程阻塞，3种细分：

1. **blocked** 
   专指等待获取monitor，进入`synchronized`块的线程。

   jstack输出:

   ```
   java.lang.Thread.State: BLOCKED (on object monitor)
   ```

2. **waiting** 
   有两个方法会导致线程进入该状态：`Unsafe.park()` 和 `Object#wait`。

   前者用于阻塞某个线程，典型场景是使用了JUC包内提供的同步器或同步数据结构，它们的内部依赖`LockSupport`类阻塞线程，该类进一步调用了`Unsafe.park()`。它的jstack输出为：

   ```
   java.lang.Thread.State: WAITING (parking)
   ```

   后者jstack输出如下。`Thread#join()`也是基于java自带的monitor/condition机制实现的：

   ```
   java.lang.Thread.State: WAITING (on object monitor)
   ```

3. **timed_waiting** 
   `Unsafe.park()` 和 `Object#wait()`的超时版本会让线程进入这个状态。

   此外，调用`Thread.sleep(...)`主动睡眠也是进入`timed_waiting`状态，此时jstack输出：

   ```
   java.lang.Thread.State: TIMED_WAITING (sleeping)
   ```

## 4. 线程中断

中断相关的几个方法：

```
public void interrupt(); // 中断某个线程；
public boolean isInterrupted(); // 返回线程的中断标志位；
public static boolean interrupted(); //返回*当前*线程的中断标志位，并重置。这可以保证并发结构不会就某个任务被中断这个问题通知你两次；
```

每个线程都有一个interrupt status标志位，用于表明当前线程是否处于中断状态。调用`Thread#interrupt()`时：

1. 若线程处于 **可中断的阻塞状态** (即`WAITING / TIMED_WAITING` 状态)，则复位中断标志位，立即取消阻塞状态，并抛出`InterruptedException`(这也是为什么这些方法签名都会抛出 `InterruptedException`的原因)，`InterruptedException`的处理者决定如何响应中断请求；
2. 其他情况下，仅设置其`中断标志位`， 需要该线程先通过`Thread#isInterrrupted()`或`Thread.interrupted()`查询再处理。

由此可见，中断是一种协作机制，interrupt一个线程不是粗鲁地立即停止其当前正在进行的事情，而是请求该线程在它愿意并且方便的时候停止它的执行，这种请求可能是粗暴的(抛出`InterruptedException`)，可能是温和的(仅设置中断标志位)。

被中断线程可以用任意方式处理中断信号，对于非阻塞但耗时较长的操作，可以轮询中断状态位，在被中断的时候执行必要的逻辑并退出。中断使得我们可以更安全地取消任务：不负责任地立即杀死一个线程可能导致资源的泄露、事务的不完整或业务的缺失等等，需要给被中断线程一个机会在退出之前进行必要的清理工作。

**无法处理InterruptedException时怎么办？**

1. 继续抛出InterruptedException，让上层处理：
2. 如果无法上抛异常，须在`catch`块里调用`Thread.currentThread().interrupt()`设置当前的中断标记位，让后续逻辑知道线程被中断过。
3. 不要 swallow 异常。

**使用interrupt()实现可取消的任务:**

```
public class PrimeProducer extends Thread {
    private final BlockingQueue<BigInteger> queue;

    PrimeProducer(BlockingQueue<BigInteger> queue) {
        this.queue = queue;
    }

    public void run() {
        try {
            BigInteger p = BigInteger.ONE;
            //轮询中断标志位，判断是否需要取消任务
            while (!Thread.currentThread().isInterrupted())
               queue.put(p = p.nextProbablePrime());
        } catch (InterruptedException consumed) {
           /* 任务被取消，退出。这里对中断的处理方式就是退出任务，因此可以swallow */
        }
    }

    //发起中断，取消任务执行
    public void cancel() { interrupt(); }
 }
```

参考资料：[ Java theory and practice: Dealing with InterruptedException](http://www.ibm.com/developerworks/java/library/j-jtp05236.html)

## 5. 互斥和协作

二元lock保证线程之间的互斥，让线程顺序地进入临界区，保证线程不会观察到其他线程操作的中间状态；condition则用于线程间的协作，当某个线程发现条件不满足时主动进入阻塞，直到其他线程修改了条件并将其唤醒。条件的测试和修改都要锁保证互斥, 因此几乎在所有的实现中, **condition 都是和一个锁绑定在一起, 工作在一个锁的上下文中的**; 但一个锁可以有多个`condition`。

[Why do pthreads’ condition variable functions require a mutex?](http://stackoverflow.com/questions/2763714/why-do-pthreads-condition-variable-functions-require-a-mutex)

`condition` 和 `lock` 的使用范式如下:

```
condition = lock.newCondition()

/* consumer */
lock()
    while(条件不成立){
        condition.wait() // 1.原子地[ 释放锁 + 阻塞线程 ]; 2.然后原子地[ 被唤醒 + 尝试获取锁]
    }
    // 条件成立, do sth
unlock()

/* producer */
lock()
    // do sth
    改变条件
    condition.signalAll()  // 唤醒阻塞在该 condition 上的线程, 让它们重新参与锁的竞争
unlock()
```

`wait`必须包裹在一个对条件的循环测试中, 这是因为`wait`存在 [Supurious Wakeup](http://en.wikipedia.org/wiki/Spurious_wakeup) 的问题, 即线程可能莫名其妙地被唤醒; 此外, 为了防止由于疏忽导致条件在`lock`的临界区外被更新, 被阻塞的线程在醒来后需要再一次判断条件是否成立, 如果不成立则继续阻塞.

Java 在语言层面提供了内置的 `lock(monitor) + condition` 组合:

```
Object lock = new Object();

public void consume(){
    synchronized(lock){
        while(条件不成立)
            lock.wait();
        // consume
    }
}

public void produce(){
    synchronized(lock){
        // produce
        改变条件
        lock.notifyAll(); // or notify()
    }
}
```

每个 Object 都内置一把锁, 该锁内部有且只有一个隐含的 condition. `synchronized(obj){}`即获取该锁并在块结束的时候自动释放锁, `obj.wait()`即在该 condition 上等待; `obj.notify()` 和 `obj.notifyAll()` 则是唤醒在该 condition 等待的线程重新竞争锁, 不同的是前者唤醒一个线程, 后者唤醒所有.

## 6. 死锁的4个必要条件

1. **资源独占** 
   资源的使用是互斥的。
2. **不可剥夺** 
   不可强行从资源占有者手中夺取资源，只能由占有者自愿释放。
3. **请求与保持** 
   申请资源的时候同时保持对原有资源的占有。
4. **循环等待** 
   若干线程同时持有的资源和请求的资源组成一个回路。

## 7. 常见的锁优化方法

1. `Lock-free` 算法，避免锁和阻塞；
2. 尽可能减小临界区长度；
3. 拆锁，如`ConcurrentHashMap` / `ReadWriteLock`；
4. CopyOnWrite，避免读加锁