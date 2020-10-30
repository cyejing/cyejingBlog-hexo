---
title : Netty源码解析-EventLoop解析
tags : [Netty]
date: 2020-07-10
---

# EventLoop 解析

首先看看 NioEventLoop 的继承图：

{% asset_img 4236553-3e7c165ac61a7b12-20200925204856017.png %}

使用红框标出了重点部分：

1. ScheduledExecutorService 接口表示是一个定时任务接口，EventLoop 可以接受定时任务。
2. EventLoop 接口：Netty 接口文档说明该接口作用：一旦 Channel 注册了，就处理该Channel对应的所有I/O 操作。
3. SingleThreadEventExecutor 表示这是一个单个线程的线程池。

解析Loop的核心方法`run`
<!--more-->


```
@Override
protected void run() {
    int selectCnt = 0;
    for (;;) {
        try {
            int strategy;
            try {
                //	Nio的策略
                strategy = selectStrategy.calculateStrategy(selectNowSupplier, hasTasks());
                switch (strategy) {
                    case SelectStrategy.CONTINUE:
                        continue;

                    case SelectStrategy.BUSY_WAIT:
                        // fall-through to SELECT since the busy-wait is not supported with NIO

                    case SelectStrategy.SELECT:
                        long curDeadlineNanos = nextScheduledTaskDeadlineNanos();
                        if (curDeadlineNanos == -1L) {
                            curDeadlineNanos = NONE; // nothing on the calendar
                        }
                        nextWakeupNanos.set(curDeadlineNanos);
                        try {
                            if (!hasTasks()) {
                                strategy = select(curDeadlineNanos);
                            }
                        } finally {
                            // This update is just to help block unnecessary selector wakeups
                            // so use of lazySet is ok (no race condition)
                            nextWakeupNanos.lazySet(AWAKE);
                        }
                        // fall through
                    default:
                }
            } catch (IOException e) {
                // If we receive an IOException here its because the Selector is messed up. Let's rebuild
                // the selector and retry. https://github.com/netty/netty/issues/8566
                //	JDK Nio的Bug 空轮询需要rebuild selector
                rebuildSelector0();
                selectCnt = 0;
                handleLoopException(e);
                continue;
            }

            selectCnt++;
            cancelledKeys = 0;
            needsToSelectAgain = false;
            final int ioRatio = this.ioRatio;
            boolean ranTasks;
            //	如果IO比例计算到100 执行IO操作 select Key
            if (ioRatio == 100) {
                try {
                    if (strategy > 0) {
                        processSelectedKeys();
                    }
                } finally {
                    // Ensure we always run tasks.
                    //	最后再执行队列里面的应用
                    ranTasks = runAllTasks();
                }
            } else if (strategy > 0) {
                final long ioStartTime = System.nanoTime();
                try {
                    processSelectedKeys();
                } finally {
                    // Ensure we always run tasks.
                    //	根据io比例算出一个执行队列任务的超时时间
                    final long ioTime = System.nanoTime() - ioStartTime;
                    ranTasks = runAllTasks(ioTime * (100 - ioRatio) / ioRatio);
                }
            } else {
                ranTasks = runAllTasks(0); // This will run the minimum number of tasks
            }

            if (ranTasks || strategy > 0) {
                if (selectCnt > MIN_PREMATURE_SELECTOR_RETURNS && logger.isDebugEnabled()) {
                    logger.debug("Selector.select() returned prematurely {} times in a row for Selector {}.",
                                 selectCnt - 1, selector);
                }
                selectCnt = 0;
            } else if (unexpectedSelectorWakeup(selectCnt)) { // Unexpected wakeup (unusual case)
                selectCnt = 0;
            }
        } catch (CancelledKeyException e) {
            // Harmless exception - log anyway
            if (logger.isDebugEnabled()) {
                logger.debug(CancelledKeyException.class.getSimpleName() + " raised by a Selector {} - JDK bug?",
                             selector, e);
            }
        } catch (Throwable t) {
            handleLoopException(t);
        }
        // Always handle shutdown even if the loop processing threw an exception.
        try {
            if (isShuttingDown()) {
                closeAll();
                if (confirmShutdown()) {
                    return;
                }
            }
        } catch (Throwable t) {
            handleLoopException(t);
        }
    }
}	
```

方法很长，我们拆解一下：

1. 默认的，如果任务队列中有任务，就立即唤醒 selector ，并返回 selector 的 selecotrNow 方法的返回值。如果没有任务，直接返回 -1，这个策略在 DefaultSelectStrategy 中。
2. 如果返回的是 -2， 则继续循环。如果返回的是 -1，也就是没有任务，则调用 selector 的 select 方法，并且设置 wakenUp 为 false。 具体再详细讲。
3. selector 返回后， 当 ioRatio 变量为100的时候（默认50），处理 select 事件，处理完之后执行任务队列中的所有任务。 反之当不是 100 的时候，处理 selecotr 事件，之后给定一个时间内执行任务队列中的任务。可以看到，ioRatio 的作用就是限制执行任务队列的时间。 关于 ioRatio , Netty 是这解释的，在 Netty 中，有2种任务，一种是 IO 任务，一种是非 IO 任务，如果 ioRatio 比例是100 的话，则这个比例无作用。公式则是建立在 IO 时间上的，公式为 ioTime * (100 - ioRatio) / ioRatio ; 也就是说，当 ioRatio 是 10 的时候，IO 任务执行了 100 纳秒，则非IO任务将会执行 900 纳秒，直到没有任务可执行。

从上面的步骤可以看出，整个 run 方法做了3件事情：

1. selector 获取感兴趣的事件。
2. processSelectedKeys 处理事件。
3. runAllTasks 执行队列中的任务。

### 核心select方法

```
private void select(boolean oldWakenUp) throws IOException {
    Selector selector = this.selector;
    try {
        int selectCnt = 0;
        long currentTimeNanos = System.nanoTime();
        long selectDeadLineNanos = currentTimeNanos + delayNanos(currentTimeNanos);
        for (;;) {
            long timeoutMillis = (selectDeadLineNanos - currentTimeNanos + 500000L) / 1000000L;
            if (timeoutMillis <= 0) {
                if (selectCnt == 0) {// 无任务则超时事件为1秒
                    selector.selectNow();
                    selectCnt = 1;
                }
                break;
            }
            if (hasTasks() && wakenUp.compareAndSet(false, true)) {// 含有任务 && 唤醒 selector 成功； 则立即返回
                selector.selectNow(); // 立即返回
                selectCnt = 1;
                break;
            }

            int selectedKeys = selector.select(timeoutMillis); // 否则阻塞给定时间，默认一秒
            selectCnt ++;
            // 如果1秒后返回，有返回值 || select 被用户唤醒 || 任务队列有任务 || 有定时任务即将被执行； 则跳出循环
            if (selectedKeys != 0 || oldWakenUp || wakenUp.get() || hasTasks() || hasScheduledTasks()) {
                break;
            }
            if (Thread.interrupted()) {
                selectCnt = 1;
                break;
            }
            // 避开 JDK bug
            long time = System.nanoTime();
            if (time - TimeUnit.MILLISECONDS.toNanos(timeoutMillis) >= currentTimeNanos) {
                selectCnt = 1;
            } else if (SELECTOR_AUTO_REBUILD_THRESHOLD > 0 &&// 没有持续 timeoutMillis 且超过 512次，则认为触发了 JDK 空轮询Bug
                    selectCnt >= SELECTOR_AUTO_REBUILD_THRESHOLD) {
                // 重建 selector
                rebuildSelector();
                selector = this.selector;
                // 并立即返回
                selector.selectNow();
                selectCnt = 1;
                break;
            }
            currentTimeNanos = time;
        }
    } 
}
```

方法也挺长的，我们来好好拆解该方法：

1. 使用`当前时间`加上`定时任务即将执行的剩余时间（如果没有定时任务，默认1秒）`。得到 selectDeadLineNanos。
2. selectDeadLineNanos 减去当前时间并加上一个缓冲值 0.5秒，得到一个 selecotr 阻塞超时时间。
3. 如果这个值小于1秒，则立即 selecotNow 返回。
4. 如果大于0（默认是1秒），如果任务队列中有任务，并且 CAS 唤醒 selector 能够成功。立即返回。
5. `int selectedKeys = selector.select(timeoutMillis)`，开始真正的阻塞（默认一秒钟），调用的是 SelectedSelectionKeySetSelector 的 select 方法，感兴趣的可以看看该方法。
6. select 方法一秒钟返回后，如果有事件，或者 selector 被唤醒了，或者 任务队列有任务，或者定时任务即将被执行，跳出循环。
7. 如果上述条件不满足，线程被中断了，则跳出循环。
8. **注意**：如果一切正常，开始判断这次 select 的阻塞时候是否大于等于给定的 timeoutMillis 时间，如果没有，且循环了超过 512 次(默认)，则认为触发了 JDK 的 epoll 空轮询 Bug，调用 rebuildSelector 方法重新创建 selector，并 selectorNow 立即返回。

以上9步基本就是 selector 方法的所有。该方法穷奇所有，压榨CPU性能，并避免了 JDK 的 bug。那么，selector 的阻塞时间有哪些地方可以干扰呢？

1. selecotr 返回了事件。
2. 任务队列有任务了。
3. 定时任务即将执行了。
4. 线程被中断了。
5. 定时任务剩余时间小于 1 秒。
6. 触发了 JDK 的bug。

以上 6 种操作都会让 select 立即返回，不会再这里死循环。

### 核心 processSelectedKeys 方法解析

当 selector 返回的时候，我们直到，有可能有事件发生，也有可能是别的原因让他返回了。而处理事件的方法就是 processSelectedKeys，我们进入到该方法查看：

```
private void processSelectedKeys() {
    if (selectedKeys != null) {
        processSelectedKeysOptimized();
    } else {
        processSelectedKeysPlain(selector.selectedKeys());
    }
}
```

判断 selectedKeys 这个变量，这个变量是一个 Set 类型，但 Netty 内部使用了 SelectionKey 类型的数组，而不是 Map 实现。这个变量什么作用呢？答：当 selector 方法有返回值的时候，JDK 的 Nio 会向这个 set 添加 SelectionKey。通过上面的代码我们看到，如果不是 null（默认开启优化） ，使用优化过的 SelectionKey，也就是数组，如果没有开启优化，则使用 JDK 默认的。

我们看看默认优化的是怎么实现的：

```
private void processSelectedKeysOptimized() {
    for (int i = 0; i < selectedKeys.size; ++i) {
        final SelectionKey k = selectedKeys.keys[i];
        selectedKeys.keys[i] = null;

        final Object a = k.attachment();

        if (a instanceof AbstractNioChannel) {
            processSelectedKey(k, (AbstractNioChannel) a);
        } else {
            NioTask<SelectableChannel> task = (NioTask<SelectableChannel>) a;
            processSelectedKey(k, task);
        }

        if (needsToSelectAgain) {
            selectedKeys.reset(i + 1);
            selectAgain();
            i = -1;
        }
    }
}
```

该方法还是比较简单的，步骤如下：

1. 循环所有 selectedKeys，拿到该 Key attach 的 Channel，判断是否是 Netty 的 AbstractNioChannel 类型。
2. 如果 needsToSelectAgain 是 true ，则将数组中 start 下标加1 之后的 key 全部设置成null。然后，调用
   selectAgain 方法，该方法会将 needsToSelectAgain 设置成 false，并调用 selectorNow 方法返回。同时也会将循环变量 i 改成 -1，再次重新循环。那么，这个 needsToSelectAgain 默认是 false ，什么时候是 true 呢？答：当调用 cancel 方法的时候，也就是 eventLoop close 的时候，取消这个 key 的事件监听。当取消次数达到了256次，needsToSelectAgain 设置成 true。而这么做的目的是什么呢？结合 Netty 的注释：当 EventLoop close 次数达到 256 次，说明了曾经的 Channel 无效了，Netty 就需要清空数组，方便 GC 回收，然后再次 selectNow ，装填新的 key。

好了，该方法的重点应该是 processSelectedKey 方法，而判断则是 a instanceof AbstractNioChannel ，还记得 Channel 注册的时候吗：

{% asset_img 4236553-78bf24285a1c4020-20200925204856018.png %}

从上面的代码中可以看出，Netty 会将 Channel 绑定到 key 上，然后在循环到事件处理的时候，拿出来直接使用。

那我们就看看 processSelectedKey 内部逻辑：

```
private void processSelectedKey(SelectionKey k, AbstractNioChannel ch) {
    final AbstractNioChannel.NioUnsafe unsafe = ch.unsafe();// NioMessageUnsafe
    if (!k.isValid()) {
        final EventLoop eventLoop = ch.eventLoop();
        unsafe.close(unsafe.voidPromise());
        return;
    }

    int readyOps = k.readyOps();
    if ((readyOps & SelectionKey.OP_CONNECT) != 0) {
        int ops = k.interestOps();
        ops &= ~SelectionKey.OP_CONNECT;
        k.interestOps(ops);
        unsafe.finishConnect();
    }
    .
    if ((readyOps & SelectionKey.OP_WRITE) != 0) {
        ch.unsafe().forceFlush();

    }
    if ((readyOps & (SelectionKey.OP_READ | SelectionKey.OP_ACCEPT)) != 0 || readyOps == 0) {
        unsafe.read();
    }
}
```

看到这里的代码，相信大家肯定很亲切，这不就是 Nio 的标准做法吗？

注意：这里的 unsafe 是每个 key 所对应的 Channel 对应的 unsafe。因此处理逻辑也是不同的。

可以说，run 方法中的 processSelectedKeys 方法的核心就是，拿到 selector 返回的所有 key 进行循环调用 processSelectedKey 方法， processSelectedKey 方法中会调用每个 Channel 的 unsafe 的对应方法。

好了， processSelectedKeys 方法到此为止。

### 核心 runAllTasks 解析

再看看 runAllTasks ，Task 里面都是一些非 IO 任务。就是通过 execute 提交的那些任务，都会添加的 task 中。

代码如下：

```
protected boolean runAllTasks(long timeoutNanos) {
    fetchFromScheduledTaskQueue();
    Runnable task = pollTask();
    if (task == null) {
        afterRunningAllTasks();
        return false;
    }

    final long deadline = ScheduledFutureTask.nanoTime() + timeoutNanos;
    long runTasks = 0;
    long lastExecutionTime;
    for (;;) {
        safeExecute(task);

        runTasks ++;

        // Check timeout every 64 tasks because nanoTime() is relatively expensive.
        // XXX: Hard-coded value - will make it configurable if it is really a problem.
        if ((runTasks & 0x3F) == 0) {
            lastExecutionTime = ScheduledFutureTask.nanoTime();
            if (lastExecutionTime >= deadline) {
                break;
            }
        }

        task = pollTask();
        if (task == null) {
            lastExecutionTime = ScheduledFutureTask.nanoTime();
            break;
        }
    }

    afterRunningAllTasks();
    this.lastExecutionTime = lastExecutionTime;
    return true;
}
```

我们来拆解一下该方法：

1. 将定时任务队列（PriorityQueue 类型的 scheduledTaskQueue）中即将执行的任务都添加到普通的 Mpsc 队列中。
2. 从 Mpsc 队列中取出任务，如果是空的，则执行 tailTasks（Mpsc 无界队列） 中的任务，然后直接结束该方法。
3. 如果不是空，则进入死循环，跳出条件有2个，1是给定的时间到了，2是没有任务了。有一个需要注意的地方就是，这个时间的检查不是每一次都检查的，而是64次循环执行一次检查，因为获取纳米时间的开销较大。
4. 最后执行 tailTasks 中的任务，并更新 lastExecutionTime 最后执行时间。

从上面的分析看出，有3种队列，分别是普通的 taskQueue，定时任务的 scheduledTaskQueue， Mpsc 的 tailQueue。

1. taskQueue，这个我们很熟悉，基本上，我们现在遇到的都是执行 execute 方法，通过 addTask 方法添加进去的。
2. 定时任务的 scheduledTaskQueue，通常在第一次调用 schedule 方法的时候会创建这个队列。同时这个任务是一般是调用 schedule 方法的时候添加进去的。主要当然是定时任务，同时也是异步的，会返回一个 ScheduledFuture 异步对象。这个对象可以添加监听器或者做一些回调，类似 permise。刚刚在上面也说了，这个队列是一个优先级队列，那么这个队列的优先级是怎么比较的呢？他的默认比较器是 SCHEDULED_FUTURE_TASK_COMPARATOR 对象，比较策略是调用 ScheduledFutureTask 的 compareTo 方法，首先任务队列的剩余时间，然后比较 id，每个任务创建时都会生成一个唯一ID，也就是加入时间的顺序。在每次 poll 之后，都会比较所有的任务，让优先级最高的任务排在数组第一位。
3. tailQueue 针对这个任务，Netty 在 executeAfterEventLoopIteration 方法的注释上意思是，添加一个任务，在 EnentLoop 下个周期运行，就像我们源码中的，每次在运行任务之后，如果还有时间的话就会运行这个队列中的任务，一般这个队列中放一些优先级不高的任务。但楼主在源码中没有找到应用他的地方。多说一句，该 Queue 也是一个 Mpsc 队列。

最后对 lastExecutionTime 进行赋值，有什么作用呢？在 confirmShutdown 方法中，会对该变量进行判断：

{% asset_img 4236553-b95093bb91f820ba-20200925204856020.png %}

{% asset_img 4236553-8f367362b57a6cce-20200925204856019.png %}

在 EventLoop 的父类 SingleThreadEventExecutor 的 doStartThread 方法的 finally 块中，也就是如果 run 方法结束了，会执行这里的逻辑，确认是否关闭了，如果定时任务最后一次的执行时间距离现在的时间 小于等于 `优雅关闭的静默期时间（默认2秒）`，则唤醒 selector，并睡眠 0.1 秒，返回 false，表示还没有关闭呢？并继续循环，在 confirmShutdown 的上方逻辑上回继续调用 runAllTasks 方法。此处应该时担心关闭的时候还有尚未完成的定时任务吧。

好，到这里，关于 runAllTasks 方法就解释的差不多了。

## 总结

总上面的分析中，我们看到了 EventLoop 作为 Netty 的核心是如何处理，每次执行 ececute 方法都是向队列中添加任务。当第一次添加时就回启动线程，执行 run 方法，而 run 方法是整个 EventLoop 的核心，就像 EventLoop 的名字一样，Loop Loop ，不停的 Loop ，Loop 做什么呢？做3件事情。

1. 调用 selecotr 的 select 方法，默认阻塞一秒钟，如果有定时任务，则在定时任务剩余时间的基础上在加上0.5秒进行阻塞。当执行 execute 方法的时候，也就是添加任务的时候，回唤醒 selecor，防止 selecotr 阻塞时间过长。
2. 当 selector 返回的时候，回调用 processSelectedKeys 方法对 selectKey 进行处理。
3. 当 processSelectedKeys 方法执行结束后，则按照 iaRatio 的比例执行 runAllTasks 方法，默认是 IO 任务时间和非 IO 任务时间是相同的，你也可以根据你的应用特点进行调优 。比如 非 IO 任务比较多，那么你就讲 ioRatio 调小一点，这样非 IO 任务就能执行的长一点。防止队列钟积攒过多的任务。
