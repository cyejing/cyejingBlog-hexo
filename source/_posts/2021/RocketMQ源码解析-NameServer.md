---

title : RocketMQ源码解析-NameServer
tags : [RocketMQ]
date : 2021-3-10
---

## NameServer

NameServer相当于配置中心，维护Broker集群、Broker信息、Broker存活信息、主题与队列信息等。NameServer彼此之间不通信，每个Broker与集群内所有的Nameserver保持长连接。

### NamesrvController解析

```java
// 核心主要的类
public class NamesrvController {
		//	主要配置信息
    private final NamesrvConfig namesrvConfig;
		//	服务配置信息
    private final NettyServerConfig nettyServerConfig;
		//	NameServer 定时任务执行线程池，默认定时执行两个任务：
    //	任务1、每隔 10s 扫描 broker ,维护当前存活的Broker信息。
    //	任务2、每隔 10s 打印KVConfig 信息。
    private final ScheduledExecutorService scheduledExecutorService = Executors.newSingleThreadScheduledExecutor(new ThreadFactoryImpl(
        "NSScheduledThread"));
  	//	读取或变更NameServer的配置属性，加载 NamesrvConfig 中配置的配置文件到内存，此类一个亮点就是使用轻量级的非线程安全容器，再结合读写锁对资源读写进行保护。尽最大程度提高线程的并发度。
    private final KVConfigManager kvConfigManager;
  	//	NameServer 数据的载体，记录 Broker、Topic 等信息。
    private final RouteInfoManager routeInfoManager;
		//	开启服务端口
    private RemotingServer remotingServer;
		//	连接断开的时候清理broker信息
    private BrokerHousekeepingService brokerHousekeepingService;

    private ExecutorService remotingExecutor;

  
  ....
```
### KVConfigManager解析
```java
// kv存储主要类

public class KVConfigManager {

    private final NamesrvController namesrvController;

  	//	读写锁，控制第configTable的所有操作
    private final ReadWriteLock lock = new ReentrantReadWriteLock();
  	//	所有kv存储在map对象，每次写入会序列化到本地文件
    private final HashMap<String/* Namespace */, HashMap<String/* Key */, String/* Value */>> configTable =
        new HashMap<String, HashMap<String, String>>();
  
```

### RouteInfoManager解析

```java
//	NameServer 数据的载体，记录 Broker、Topic 等信息
public class RouteInfoManager {
  
    private final static long BROKER_CHANNEL_EXPIRED_TIME = 1000 * 60 * 2;
    private final ReadWriteLock lock = new ReentrantReadWriteLock();
  	//	topicQueueTable，主题与队列关系，记录一个主题的队列分布在哪些Broker上，每个Broker上存在该主题的队列个数。QueueData队列描述信息
    private final HashMap<String/* topic */, List<QueueData>> topicQueueTable;
  
  	//	brokerAddrTable,所有 Broker 信息，使用 brokerName 当key, BrokerData 信息描述每一个 broker 信息。
    private final HashMap<String/* brokerName */, BrokerData> brokerAddrTable;
  	//	clusterAddrTable，broker 集群信息，每个集群包含哪些 Broker。
    private final HashMap<String/* clusterName */, Set<String/* brokerName */>> clusterAddrTable;
  	//	brokerLiveTable，当前存活的 Broker,该信息不是实时的，NameServer 每10S扫描一次所有的 broker,根据心跳包的时间得知 broker的状态
    private final HashMap<String/* brokerAddr */, BrokerLiveInfo> brokerLiveTable;
  	//	过滤服务列表
    private final HashMap<String/* brokerAddr */, List<String>/* Filter Server */> filterServerTable;
 		.... 
}

public class QueueData{
  private String brokerName;           // broker的名称

  private int readQueueNums;           // 读队列个数

  private int writeQueueNums;          // 写队列个数

  private int perm;                    // 权限操作

  private int topicSynFlag;            //  同步复制还是异步复制
}

public class BorkerData{
  // broker所属集群
  private String cluster;                           

  // broker name
  private String brokerName;
 
 	//	broker 对应的IP:Port,brokerId=0表示Master,大于0表示Slave。             
	private HashMap<Long/* brokerId */, String/* broker address */> brokerAddrs;
}
```
