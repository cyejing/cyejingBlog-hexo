---
title: InnoDB 锁
tags : [mysql]
date : 2018-03-04
---
# InnoDB 锁



## 1. 事务并发问题

1. 脏读（`Dirty Read`）： 
   A 看到 B 进行中更新的数据，并以此为根据继续执行相关的操作；B 回滚，导致 A 操作的是脏数据。
2. 不可重复读（`Non-repeatable Read`）： 
   A 先查询一次数据，然后 B 更新之并提交，A 再次查询，得到和上一次不同的查询结果。
3. 幻读（`Phantom Read`）： 
   A 查询一批数据，B 插入或删除了某些记录并提交，A 再次查询，发现结果集中出现了上次没有的记录，或者上次有的记录消失了。
4. 第二类丢失更新 (`覆盖丢失`)： 
   A 和 B 更新同一条记录并提交，后提交的数据将覆盖先提交的，通常这是没问题的，但是在某些情况下，如在程序中自增自减、程序中的读-改-全量更新，就会出现并发问题。*这类问题更像是应用层面的，不属于DB范畴。*

<!--more-->

## 2. 事务隔离级别

1. read uncommited 
   最弱，事务的任何动作对其他事务都是立即可见的。存在脏读、不可重复读、幻读问题（除了回滚丢失，其他的并发问题都有）。

2. read commited 
   只能读到其他事务已提交的数据，中间状态的数据则看不到，解决了`脏读`问题。

3. repeatable read **(InnoDB的默认隔离级别)** 
   根据标准的SQL规范，该级别解决了`不可重复读`的问题，保证在一个事务内，对同一条记录的重复读都是一致的。

   > InnoDB 的 Repeatable Read 通过 *MVCC* 和 *间隙锁* 机制额外解决了`幻读`问题。

4. serial 
   最高，所有读写都是串行的。

InnoDB 对事务隔离级别的实现依赖两个手段：锁、MVCC(多版本控制协议)。MVCC可以认为是对锁机制的优化，让普通select避免加锁，同时还能有事务隔离级别的语义保证。

## 3. MVCC

MVCC，Multi-Version Concurrency Control，为一条记录维护多个不同的snapshot，并记录各snapshot对应的版本号（事务ID），每个事务可以读到的snapshot是受限的，从而隔离其他事务的并发动作。

MVCC并发控制中，读操作分为两类：快照读 (snapshot read)与当前读 (current read)。前者读取的是记录的snapshot(有可能是历史版本)，不用加锁；后者读取的是记录的最新版本，且会加上锁，保证其他事务不会并发修改这条记录。

**快照读：**

1. 普通的select均为快照读，不用加锁；

**当前读：**

1. `select... lock in shared mode`: 读锁
2. `select... for update`: 写锁
3. DML（insert/delete/update）：写锁

MVCC 只工作在RC & RR两个隔离级别下，Read Uncommited 直接读数据；Serializable 所有读都是当前读。

在RR级别下，快照读只能读取本事务开始之前的snapshot，反复读同一条记录，不会看到其他事务对它的更新动作；反复执行同一条查询，不会看到其他事务插入的新记录，也不会丢失其他事务删除的记录（删除并非立刻物理删除）。可以看到，RR级别下，普通的select没有`不可重复读`和`幻读`的问题。

在RC级别下，快照读读取的是记录最新的snapshot，可以看到其他事务已提交的内容。

## 4. 锁

### 二阶段加锁协议 (Two-Phase Locking)

事务中只加锁不释放，事务结束一起释放。

### 锁的细分

锁可以从两个维度上进行细分。

根据粒度大小（InnoDB 称为 lock type）锁可以细分为**表锁** 和 **行锁**。表锁对整个表加锁，影响表内的所有记录，行锁只影响一条记录，粒度更细，并发程度高。行锁根据场景的不同又可以进一步细分（稍后详细介绍）。

[lock0lock.h](http://osxr.org/mysql/source/storage/innobase/include/lock0lock.h#0833)：

```
#define LOCK_TABLE  16  /* table lock */
#define LOCK_REC    32  /* record lock */

/* Precise modes */

/* ... ordinary next-key lock in contrast to LOCK_GAP or LOCK_REC_NOT_GAP*/
#define LOCK_ORDINARY   0   

/* ... the lock holds only on the gap before the record; for instance, an x-lock on the gap does not give permission to modify the record on which the bit is set ... */
#define LOCK_GAP    512 

/* ... the lock is only on the index record and does NOT block inserts to the gap before the index record; this is used in the case when we retrieve a record with a unique key, and is also used in locking plain SELECTs (not part of UPDATE or DELETE) when the user has set the READ COMMITTED isolation level */
#define LOCK_REC_NOT_GAP 1024   

/* this bit is set when we place a waiting gap type record lock request in order to let an insert of an index record to wait until there are no conflicting locks by other transactions on the gap; note that this flag remains set when the waiting lock is granted, or if the lock is inherited to a neighboring record */
#define LOCK_INSERT_INTENTION 2048 
```

锁的 mode 分类如下所示：

[lock0types.h](http://osxr.org/mysql/source/storage/innobase/include/lock0types.h):

```
/* Basic lock modes */
enum lock_mode {
    LOCK_IS = 0, /* intention shared */
    LOCK_IX,    /* intention exclusive */
    LOCK_S,     /* shared */
    LOCK_X,     /* exclusive */
    LOCK_AUTO_INC,  /* locks the auto-inc counter of a table in an exclusive mode*/
    ...
};
```

将锁分为读锁和写锁主要是为了提高读的并发，它们的兼容性矩阵：

```
  S  X
S +  – 
X -  -
```

IX(写意向)、IS(读意向)只会应用在表锁上，方便表锁和行锁之间的冲突检测。`LOCK_AUTO_INC`是一种特殊的表锁。

### 表锁

`LOCK TABLES t1 READ, t2 WRITE` 对表加 S 或 X 锁、`ALTER TABLE`需要加 X 锁。

表锁的实现有两个层面，MySQL Server 和 InnoDB 存储引擎，innodb_table_locks 参数为1（默认值）表明当 autocommit 关闭时启用 InnoDB 表锁。此时调用 `LOCK TABLES`, MySQL Server 和 InnoDB 都会加表锁，不同的是，前者加的锁只有显式调用 `UNLOCK TABLES` 才会释放，InnoDB 层面的表锁则会在事务提交时自动释放。

`LOCK TABLES` 搭配 InnoDB 表锁的正确使用姿势：

```
SET autocommit=0;
LOCK TABLES t1 WRITE, t2 READ, ...;
... do something with tables t1 and t2 here ...
COMMIT;
UNLOCK TABLES;
```

Manual：[Interaction of Table Locking and Transactions](https://www.evernote.com/OutboundRedirect.action?dest=https%3A%2F%2Fdev.mysql.com%2Fdoc%2Frefman%2F5.6%2Fen%2Flock-tables-and-transactions.html)

#### 意向表锁

表锁锁定了整张表，因此表锁和行锁之间也会冲突，为了方便检测表锁和行锁的冲突引入了**意向表锁**。

1. 意向锁分为意向读锁(IS)和意向写锁(IX)。
2. 意向锁是表级锁，但表示事务试图读或写某一行记录，而不是整个表。所以意向锁之间不会产生冲突，真正的冲突在加行锁时检查。
3. 在给一行记录加锁前，首先要给该表加意向锁。也就是要同时加表意向锁和行锁。

#### AUTO_INC表锁

为一个AUTO_INCREMENT列生成自增值前，必须先为该表加 AUTO_INC 表锁。AUTO_INC 表锁有些特别的地方：

1. 每个表最多只能有一个自增锁
2. 为了提高并发插入的性能，**自增锁不遵循二阶段锁协议**，加锁释放锁不跟事务而跟语句走，insert开始时获取，结束时释放
3. 自增值只要分配了就会+1，不管事务是否提交了都不会撤销，所以可能出现空洞。

从5.1.22开始，MySQL 提供了一种可选的轻量级锁(mutex)机制代替AUTO_INC表锁，参数 innodb_autoinc_lock_mode 控制分配自增值时的并发策略。介绍该参数之前先引入几个insert相关的概念：

1. **Simple inserts**：通过分析insert语句可以确定插入数量的insert语句，如`INSERT, INSERT … VALUES(1,2),VALUES(3,4)`

2. **Bulk inserts**：通过分析insert语句无法知道插入数量的insert语句，`INSERT … SELECT, REPLACE … SELECT, LOAD DATA`

3. **Mixed-mode inserts**：不确定是否需要分配auto_increment id，一般是下面两种情况

   ```
   INSERT INTO t1 (c1,c2) VALUES (1,'a'), (NULL,'b'), (5,'c'), (NULL,'d')
   -- 有些指定了id，有些没
   INSERT … ON DUPLICATE KEY UPDATE
   ```

参数innodb_autoinc_lock_mode可以取下列值：

1. **innodb_autoinc_lock_mode=0 （traditional lock mode）** 
   使用传统的 AUTO_INC 表锁，并发性比较差；

2. **innodb_autoinc_lock_mode=1 （consecutive/连续 lock mode）默认值** 
   折中方式，bulk 不能确定插入数用表锁，simple、mix用mutex，只锁住预分配自增ID的过程，不锁整张表。Mixed-mode inserts 会直接分析语句，获得最坏情况下需要插入的数量，一次性分配足够的auto_increment id，缺点是会分配过多的id，导致“浪费”和空洞。

   这种模式既平衡了并发性，又能保证**同一条insert语句分配的自增id是连续的**。

3. **innodb_autoinc_lock_mode=2 （interleaved/交叉 lock mode）** 
   全部都用mutex，并发性能最高，id一个一个分配，不会预分配。缺点是不能保证同一条insert语句内的id是连续的，但是在replication中，当binlog_format为statement-based时（基于语句的复制）存在问题，因为是来一个分配一个，同一条insert语句内获得的自增id可能不连续，主从数据集会出现数据不一致。

#### 表锁的兼容性

以上表锁的兼容性矩阵如下：（+兼容，-不兼容）

| .    | IS   | IX   | S    | X    | AI   |
| ---- | ---- | ---- | ---- | ---- | ---- |
| IS   | +    | +    | +    |      | +    |
| IX   | +    | +    |      |      | +    |
| S    | +    |      | +    |      |      |
| X    |      |      |      |      |      |
| AI   | +    | +    |      |      |      |

意向表锁只会阻塞X/S表锁，不会阻塞意向表锁和AUTO_INC表锁；

### 行锁

#### 行锁的分类

行锁从mode上分为X、S，type上进一步细分为以下类型：

1. **LOCK_GAP**：GAP锁，锁两个记录之间的GAP，防止记录插入；
2. **LOCK_ORDINARY**：官方文档中称为 “Next-Key Lock” ，锁一条记录及其*之前*的间隙，这是RR级别用的最多的锁，从名字也能看出来；
3. **LOCK_REC_NOT_GAP**：只锁记录；
4. **LOCK_INSERT_INTENSION**：插入意向GAP锁，插入记录时使用，是LOCK_GAP的一种特例。

RC级别只有记录锁，没有 Next-Key Lock 和 GAP锁，因此存在幻读现象。

行锁是加在记录上的锁，InnoDB中的记录是以B+树索引的方式组织在一起的，InnoDB的行锁实际是 index record lock，即对B+索引叶子节点的锁。索引可能有多个，因此操作一行数据时，有可能会加多个行锁在不同的B+树上。

#### where的执行原理及加锁对象

分析不同SQL语句的加锁情况前，有必要先介绍下 SQL 中 where 条件是怎么解析和执行的。假设 where 走某个Secondary索引A，where 中所有的条件可以分为三类：

1. **index key**：用于确定索引**扫描**的起始位置和结束位置，因为是范围，所以分 index first key 和 index last key。查询时，先通过 index first key 条件在B+树上做一次**搜索**确定扫描开始位置（从B+树的根节点一层层往下找），从该处开始沿着叶子节点组成的链表扫描，碰到的每个节点都要与 index last key 比对，判断是否超出扫描范围。

   > 注意**扫描** / **搜索**的区别：搜索是从根节点到叶子节点的定位过程，扫描针对的是索引叶子节点组成的链表。

2. **index filter**：是索引A的字段，但无法应用在搜索过程中，只能在扫描索引时对结果集进行过滤，不需额外查询聚集索引；

3. **table filter**：不是索引A的字段，innodb 对根据前面两个条件扫描得到的结果集，去聚集索引上读了完整数据后返回给MySQL Server，后者再用table filter过滤。

对于除 insert 以外的**当前读**，如 `SELECT…[FOR UPDATE | LOCK IN SHARE MODE]`、`UPDATE`、`DELETE`，加锁的对象是**索引扫描后，将要返回给MySQL Server进一步过滤的那些记录**。

> 在MySQL 5.6之前，并不区分Index Filter与Table Filter，统统将Index First Key与Index Last Key范围内的索引记录，回表读取完整记录，然后返回给MySQL Server层进行过滤。而在MySQL 5.6之后，Index Filter与Table Filter分离，Index Filter下降到InnoDB的索引层面进行过滤，减少了回表与返回MySQL Server层的记录交互开销，提高了SQL的执行效率。

#### 加锁规则

在RR级别下，有如下加锁规则：

1. 用于搜索和扫描的（where条件走的）索引，加 Next-Key Lock。对于扫描得到的最后一个记录，还要对它和下一条记录之间的空隙加 GAP Lock。**记录间的间隙（包括第一个记录之前、最后一个记录之后的间隙）都加了锁，新的记录无法插入到这些位置，保证了不会出现幻读**；

   如果索引是唯一索引或主索引，且SQL是个等值查询，由于有唯一性的保证，可不用锁间隙，加Record Lock 而非 Next-Key Lock。

   如果没有查询到记录，定位到的GAP依然会被锁上，这样才不会出现幻读。

2. where索引扫描的结果集，在其他索引上对应的记录，加Record Lock；

3. 不同索引的加锁顺序：where索引 –> 主索引 –> 其他二级索引；

4. 如果没法走索引而走全表扫描，主索引的全部记录都会加 Next-Key Lock，加锁的顺序不定。此时该表除了不加锁的快照读，其他所有需要加锁的SQL如插入、更新、删除均不可执行。

   MySQL Server层对这种情况会做优化，不符合条件的记录会立刻释放锁，但这种优化违背了二阶段锁协议，而且InnoDB加锁的动作不会省略。

`INSERT` 的加锁：

1. 插入之前，对插入的间隙加插入意向GAP锁 ；

   插入意向GAP锁表明将向某个间隙插入记录，如果该间隙已被加上了GAP Lock或Next-Key Lock，则加锁失败。

   不同事务加的插入意向GAP锁互相兼容，否则就无法并发insert了。

2. 插入成功后，对插入的这条记录加X Record Lock；

3. 如果违反唯一性约束导致插入失败，则对记录加S Next-Key Lock。这一点在并发插入时可能导致死锁。

#### 行锁的兼容性

S锁和S锁完全兼容，兼容性检测只发生在S和X、X和S之间。行锁的兼容性矩阵如下（由`lock0lock.c:lock_rec_has_to_wait()` 函数推出）：

| .        | GAP   | II GAP | RECORD | NEXT-KEY |
| -------- | ----- | ------ | ------ | -------- |
| GAP      | **+** | **+**  | **+**  | **+**    |
| II GAP   |       | **+**  | **+**  |          |
| RECORD   | **+** | **+**  |        |          |
| NEXT-KEY | **+** | **+**  |        |          |

1. 第一行，GAP锁不需要等待其他任何行锁（why？）；
2. 第二行，GAP锁、Next-Key锁会阻止 Insert；插入意向锁互相是兼容的，即并发插入是允许的；
3. 第三行，RECORD锁和RECORD锁、Next-Key锁冲突；
4. 第二列，已有的插入意向GAP锁不会阻止任何锁。

## 5. 查看锁

### InnoDB Lock Monitor

InnoDB 提供了InnoDB Monitor，可以显示InnoDB的内部状态，打开该项特性后，每隔15秒MySQL就会把`SHOW ENGINE INNODB STATUS`命令的输出重定向到标准错误输出流，如果设置了innodb-status-file=1 ，还会将上述命令的输出额外写到一个名为*innodb_status.pid*的文件中。此外，如果开启了InnoDB Lock Monitor，还会打印额外的锁信息。

MySQL 5.6.16 以后使用以下两个命令打开 InnoDB Standard Monitor 和 InnoDB Lock Monitor：

```
set global innodb_status_output=ON;
set global innodb_status_output_locks=ON;
```

`SHOW ENGINE INNODB STATUS` 的输出示例：

———— 
TRANSACTIONS 
———— 
Trx id counter 169246 
Purge done for trx’s n:o < 169198 undo n:o < 0 state: running but idle 
History list length 802 
LIST OF TRANSACTIONS FOR EACH SESSION:

**事务1**： 
—TRANSACTION 169245, ACTIVE 4 sec inserting 
mysql tables in use 1, locked 1 
**LOCK WAIT 2 lock** struct(s), heap size 360, 1 row lock(s) *==== 事务在等待锁，涉及两个锁，其中1个是行锁* 
MySQL thread id 699, OS thread handle 0x7fd4ad4e3700, query id 10304 localhost root update 
**insert into t2 values(3,3)** *==== 正在执行的SQL* 
——- TRX HAS BEEN WAITING 4 SEC FOR THIS LOCK TO BE GRANTED: 
RECORD LOCKS space id 8 page no 3 n bits 72 index `PRIMARY` of table `test`.`t2` trx id 169245 lock_mode X locks gap before rec insert intention waiting 
—————— 
**TABLE LOCK** table `test`.`t2` trx id 169245 **lock mode IX** *==== IX插入意向表锁* 
**RECORD LOCKS** space id 8 page no 3 n bits 72 index `PRIMARY` of table `test`.`t2` trx id 169245 **lock_mode X locks gap before rec insert intention** waiting *====在等待X插入意向GAP锁*

**事务2**： 
—TRANSACTION 169244, ACTIVE 11 sec 
**2 lock struct(s)**, heap size 360, 1 row lock(s) 
MySQL thread id 698, OS thread handle 0x7fd4a3c54700, query id 10305 localhost root init 
show engine INNODB status 
**TABLE LOCK table** `test`.`t2` trx id 169244 **lock mode IX** 
**RECORD LOCKS** space id 8 page no 3 n bits 72 index `PRIMARY` of table `test`.`t2` trx id 169244 **lock_mode X locks gap before rec** *====GAP锁*

各种锁在`show engine InnoDB status`中的表现：

| 锁类型                   | 输出                                       |
| --------------------- | ---------------------------------------- |
| LOCK_TABLE            | TABLE LOCK table xxx lock mode [S\|X\|IS\|IX] |
| LOCK_REC_NOT_GAP      | RECORD LOCKS … lock_mode [X\|S] locks rec but not gap |
| LOCK_ORNIDARY         | RECORD LOCKS … lock_mode [X\|S]          |
| LOCK_GAP              | RECORD LOCKS … lock_mode [X\|S] locks gap before rec |
| LOCK_INSERT_INTENTION | RECORD LOCKS … lock_mode X insert intention |

### INFORMATION_SCHEMA 内的表

**INNODB_TRX**： 
当前正在执行的事务详情

**INNODB_LOCKS**： 
每个引起阻塞的锁两个记录。1.哪个事务持有；2.哪个事务请求。

示例：

```
*************************** 1. row ***************************
    lock_id: 169245:8:3:3
lock_trx_id: 169245
  lock_mode: X,GAP      // -- row->lock_mode = lock_get_mode_str(lock)
  lock_type: RECORD     // -- row->lock_type = lock_get_type_str(lock)
 lock_table: test.t2    
 lock_index: PRIMARY
 lock_space: 8
  lock_page: 3
   lock_rec: 3
  lock_data: 4
*************************** 2. row ***************************
    lock_id: 169244:8:3:3
lock_trx_id: 169244
  lock_mode: X,GAP
  lock_type: RECORD
 lock_table: test.t2
 lock_index: PRIMARY
 lock_space: 8
  lock_page: 3
   lock_rec: 3
  lock_data: 4
```

1. **lock_mode: [X|S|IX|IS], [GAP]**，只有LOCK_GAP才会显示GAP，见 lock_get_mode_str()。
2. **lock_type: [Record|Table]**，只能区分表锁、行锁，行锁的细分模式无法识别。

**INNODB_LOCK_WAITS** 
每个被锁阻塞的事务一个记录。

示例：

```
*************************** 1. row ***************************
requesting_trx_id: 169245           // 请求锁的事务
requested_lock_id: 169245:8:3:3     // 请求的锁ID
  blocking_trx_id: 169244           // 持有锁的事务
 blocking_lock_id: 169244:8:3:3     // 导致阻塞的锁ID，和请求的锁ID是同一个锁，只是事务前缀不一样
1 row in set (0.00 sec)
```

用一个神奇的SQL把这些表join起来分析……

```
SELECT
    r.trx_id waiting_trx_id,
    r.trx_mysql_thread_id waiting_thread,
    left(r.trx_query,20) waiting_query,
    concat(concat(lw.lock_type,' '),
    lw.lock_mode) waiting_for_lock,
    b.trx_id blocking_trx_id,
    b.trx_mysql_thread_id blocking_thread,
    left(b.trx_query,20) blocking_query,
    concat(concat(lb.lock_type,' '),
    lb.lock_mode) blocking_lock   
FROM
    information_schema.innodb_lock_waits w   
INNER JOIN
    information_schema.innodb_trx b 
        ON b.trx_id = w.blocking_trx_id   
INNER JOIN
    information_schema.innodb_trx r 
        ON r.trx_id = w.requesting_trx_id   
INNER JOIN
    information_schema.innodb_locks lw 
        ON lw.lock_trx_id = r.trx_id   
INNER JOIN
    information_schema.innodb_locks lb 
        ON lb.lock_trx_id = b.trx_id
```

结果：

```
*************************** 1. row ***************************
  waiting_trx_id: 169245
  waiting_thread: 699
   waiting_query: insert into t2 value
waiting_for_lock: RECORD X,GAP
 blocking_trx_id: 169244
 blocking_thread: 698
  blocking_query: SELECT r.trx_id wait
   blocking_lock: RECORD X,GAP
```

## 6. 两个简单的死锁示例

### 不走索引的DELETE引发的死锁

`SHOW ENGINE INNODB STATUS`显示的死锁现场：

———————— 
LATEST DETECTED DEADLOCK 
———————— 
150626 11:02:07 
*** (1) TRANSACTION: 
TRANSACTION 13260F7, ACTIVE 0 sec starting index read 
mysql tables in use 1, locked 1 
LOCK WAIT 5 lock struct(s), heap size 1248, 3 row lock(s), undo log entries 2 
MySQL thread id 216331, OS thread handle 0x7f5784637700, query id 136610709 10.32.57.98 movie_mc updating 
**DELETE FROM mc_message WHERE msg_session_id = 1250079** 
*** (1) WAITING FOR THIS LOCK TO BE GRANTED: 
**RECORD LOCKS** space id 10 page no 5 n bits 328 index `PRIMARY` of table `movie_message_center`.`mc_message`trx id 13260F7 **lock_mode X** waiting

*** (2) TRANSACTION: 
TRANSACTION 13260F5, ACTIVE 0 sec fetching rows 
mysql tables in use 1, locked 1 
4815 lock struct(s), heap size 588216, **1237194 row lock(s)**, undo log entries 1 
MySQL thread id 219612, OS thread handle 0x7f5727c78700, query id 136610669 10.32.56.108 movie_mc updating 
**DELETE FROM mc_message WHERE msg_session_id = 1348342** 
*** (2) HOLDS THE LOCK(S): 
RECORD LOCKS space id 10 page no 5 n bits 328 index `PRIMARY` of table `movie_message_center`.`mc_message` trx id 13260F5 lock_mode X 
*** (2) WAITING FOR THIS LOCK TO BE GRANTED: 
RECORD LOCKS space id 10 page no 8425 n bits 328 index `PRIMARY` of table `movie_message_center`.`mc_message`trx id 13260F5 lock_mode X waiting 
*** WE ROLL BACK TRANSACTION (1)

RR级别，对一张表的两个简单delete语句引起了死锁。由于没有走索引，delete导致主索引的所有记录及间隙都被锁上，LOG中也可以看到，第二个事务持有123万把行锁（Next-Key Lock），且由于加锁的顺序是不定的，导致死锁。

### 并发INSERT引发的死锁

这种死锁现象涉及三个以上并发事务，执行同一条insert语句引发死锁。

表的结构：

```
CREATE TABLE t1 (i INT, PRIMARY KEY (i)) ENGINE = InnoDB;
```

事务执行序列：

| tx0                           | tx1                           | tx2                           |
| ----------------------------- | ----------------------------- | ----------------------------- |
| `INSERT INTO t1 VALUES(1)`，成功 |                               |                               |
|                               | `INSERT INTO t1 VALUES(1)`，阻塞 | `INSERT INTO t1 VALUES(1)`，阻塞 |
| rollback                      |                               |                               |
|                               | 死锁                            | 死锁                            |

用 `SHOW ENGINE INNODB STATUS`分析一下：

**第一步：tx0插入成功**

—TRANSACTION 0, ACTIVE 48 sec 
1 lock struct(s), heap size 360, 0 row lock(s), undo log entries 1 
MySQL thread id 702, OS thread handle 0x7fd4ad481700, query id 10384 localhost root cleaning up 
**TABLE LOCK table test.t1 trx id 169250 lock mode IX**

按之前的分析，tx0插入成功过后应对记录加X Record Lock，但log只显示了一个IX表锁，这是因为InnoDB对锁有两种实现，一种隐式，一种显式。显式的锁需要维护特有的数据结构，隐式锁是根据当前事务ID和记录中的事务ID计算出来的，开销更小：

1. 隐式锁是针对被修改的B+Tree记录，因此都是Record类型的锁。不可能是Gap或Next-Key类型；
2. `INSERT`成功后对记录加的X锁，都是隐式锁；
3. `UPDATE`、`DELETE` 对 where 索引和主索引用显式锁，其他二级索引上的Record Lock用隐式锁；
4. 隐式锁发生冲突时会转换成显式锁。

**第二步：tx1、tx2插入阻塞**

—**TRANSACTION 2**, ACTIVE 2 sec inserting 
mysql tables in use 1, locked 1 
LOCK WAIT 2 lock struct(s), heap size 360, 1 row lock(s) 
MySQL thread id 704, OS thread handle 0x7fd4a3b90700, query id 10389 localhost root update 
INSERT INTO t1 VALUES(1) 
**——- TRX HAS BEEN WAITING 2 SEC FOR THIS LOCK TO BE GRANTED:** 
**RECORD LOCKS space id 442 page no 3 n bits 72 index PRIMARY of table test.t1 trx id 169252 lock mode S locks rec but not gap waiting** 
—————— 
TABLE LOCK table `test`.`t1` trx id 169252 lock mode IX 
RECORD LOCKS space id 442 page no 3 n bits 72 index `PRIMARY` of table `test`.`t1` trx id 169252 lock mode S locks rec but not gap waiting

—**TRANSACTION 1**, ACTIVE 4 sec inserting 
mysql tables in use 1, locked 1 
LOCK WAIT 2 lock struct(s), heap size 360, 1 row lock(s) 
MySQL thread id 703, OS thread handle 0x7fd4ac144700, query id 10388 localhost root update 
INSERT INTO t1 VALUES(1) 
**——- TRX HAS BEEN WAITING 4 SEC FOR THIS LOCK TO BE GRANTED:** 
**RECORD LOCKS space id 442 page no 3 n bits 72 index PRIMARY of table test.t1 trx id 169251 lock mode S locks rec but not gap waiting** 
—————— 
TABLE LOCK table `test`.`t1` trx id 169251 lock mode IX 
RECORD LOCKS space id 442 page no 3 n bits 72 index `PRIMARY` of table `test`.`t1` trx id 169251 lock mode S locks rec but not gap waiting

—**TRANSACTION 0**, ACTIVE 105 sec 
2 lock struct(s), heap size 360, 1 row lock(s), undo log entries 1 
MySQL thread id 702, OS thread handle 0x7fd4ad481700, query id 10384 localhost root cleaning up 
TABLE LOCK table `test`.`t1` trx id 169250 lock mode IX 
**RECORD LOCKS space id 442 page no 3 n bits 72 index PRIMARY of table test.t1 trx id 169250 lock_mode X locks rec but not gap**

1. tx0的隐式X Record Lock转成了显式；
2. tx1和tx2 duplicate-key error，试图对记录加S Record Lock，阻塞。

**第三步：tx0 rollback，发生死锁，tx2被回滚，tx1成功**

看看tx1成功后持有的锁：

—TRANSACTION 1, ACTIVE 99 sec 
5 lock struct(s), heap size 1184, 3 row lock(s), undo log entries 1 
MySQL thread id 703, OS thread handle 0x7fd4ac144700, query id 10391 localhost root cleaning up 
TABLE LOCK table `test`.`t1` trx id 169251 lock mode IX 
RECORD LOCKS space id 442 page no 3 n bits 72 index `PRIMARY` of table `test`.`t1` trx id 169251 **lock mode S locks rec but not gap** 
RECORD LOCKS space id 442 page no 3 n bits 72 index `PRIMARY` of table `test`.`t1` trx id 169251 **lock mode S** 
RECORD LOCKS space id 442 page no 3 n bits 72 index `PRIMARY` of table `test`.`t1` trx id 169251 **lock_mode X insert intention** 
RECORD LOCKS space id 442 page no 3 n bits 72 index `PRIMARY` of table `test`.`t1` trx id 169251 **lock mode S locks gap before rec**

tx1加了一堆的行锁，仔细查看会发现，tx1获取了第二步请求的S Record Lock后再次尝试插入，这里会先加一个S Next-Key Lock 和 S GAP Lock（根据log推测，没有找到文献支持），然后才加 Insert Intention GAP Lock。

再看看死锁日志： 
———————— 
LATEST DETECTED DEADLOCK 
———————— 
2015-08-07 11:17:47 7fd4a3b90700 
*** (1) TRANSACTION: 
TRANSACTION 1, ACTIVE 94 sec inserting 
mysql tables in use 1, locked 1 
LOCK WAIT 4 lock struct(s), heap size 1184, 2 row lock(s) 
MySQL thread id 703, OS thread handle 0x7fd4ac144700, query id 10391 localhost root update 
INSERT INTO t1 VALUES(1) 
*** (1) WAITING FOR THIS LOCK TO BE GRANTED: 
RECORD LOCKS space id 442 page no 3 n bits 72 index `PRIMARY` of table `test`.`t1` trx id 169251 **lock_mode X insert intention waiting** <====== 等待 II GAP Lock

*** (2) TRANSACTION: 
TRANSACTION 2, ACTIVE 92 sec inserting 
mysql tables in use 1, locked 1 
4 lock struct(s), heap size 1184, 2 row lock(s) 
MySQL thread id 704, OS thread handle 0x7fd4a3b90700, query id 10392 localhost root update 
INSERT INTO t1 VALUES(1) 
*** (2) HOLDS THE LOCK(S): 
RECORD LOCKS space id 442 page no 3 n bits 72 index `PRIMARY` of table `test`.`t1` trx id 169252 **lock mode S**<======== 持有 S Next-Key Lock 
*** (2) WAITING FOR THIS LOCK TO BE GRANTED: 
RECORD LOCKS space id 442 page no 3 n bits 72 index `PRIMARY` of table `test`.`t1` trx id 169252 **lock_mode X insert intention waiting** 
*** WE ROLL BACK TRANSACTION (2) <====== 等待 II GAP Lock

从日志可知，tx1和tx2在tx0 rollback之后，均成功获得了记录的 S Next-Key Lock，接着二者同时请求 Insert Intention GAP Lock，但与对方持有的 S Next-Key Lock 冲突，死锁发生。

## 7. 参考文档

1. MySQL各种官方文档
2. [何登成的技术博客 » MySQL 加锁处理分析](http://hedengcheng.com/?p=771)
3. [何登成的技术博客 » SQL中的where条件，在数据库中提取与应用浅析](http://hedengcheng.com/?p=577)
4. [MySQL数据库InnoDB存储引擎中的锁机制](http://www.zhdba.com/mysqlops/2012/05/19/locks_in_innodb/)
5. [Bug #35821](https://www.evernote.com/OutboundRedirect.action?dest=https%3A%2F%2Fbugs.mysql.com%2Fbug.php%3Fid%3D35821)
6. [Differences between READ-COMMITTED and REPEATABLE-READ transaction isolation levels](https://www.evernote.com/OutboundRedirect.action?dest=https%3A%2F%2Fwww.percona.com%2Fblog%2F2012%2F08%2F28%2Fdifferences-between-read-committed-and-repeatable-read-transaction-isolation-levels%2F)
7. [Understanding innodb locks and deadlocks BY PERCONA](http://www.slideshare.net/valeriikravchuk1/understanding-innodb-locks-and-deadlocks)，强烈推荐
8. 《高性能MySQL》