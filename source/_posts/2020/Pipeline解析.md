---
title : Netty源码解析-Pipeline解析
tags : [netty]
date: 2020-07-10
---

# Pipeline解析

Pipeline内部关系如图

![img](../../images/1240.png)

每个Channel创建时候会创建对应的Pipeline，不同的Pipeline就会有不同的数据处理逻辑

创建Pipeline的同时会创建``TailContext``和``HeadContext``组成双向链表

```java
// AbstractChannel
protected AbstractChannel(Channel parent) {
  this.parent = parent;
  id = newId();
  unsafe = newUnsafe();
  pipeline = newChannelPipeline();
}

// AbstractChannel
protected DefaultChannelPipeline newChannelPipeline() {
  return new DefaultChannelPipeline(this);
}

// DefaultChannelPipeline
protected DefaultChannelPipeline(Channel channel) {
  this.channel = ObjectUtil.checkNotNull(channel, "channel");
  succeededFuture = new SucceededChannelFuture(channel, null);
  voidPromise =  new VoidChannelPromise(channel, true);

  tail = new TailContext(this);
  head = new HeadContext(this);

  head.next = tail;
  tail.prev = head;
}
```

