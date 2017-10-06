---
title: Fast-Ngrok内网映射神器,集成spring-boot快速启动
tags : [spring,java,Fast-Ngrok,内网映射神器,spring-boot,快速启动]
date : 2017-10-06
---

### Fast-Ngrok

本人第一个开源软件,内网映射神器Ngrok的Java版本客户端,已经集成spring-boot,随应用启动快速映射内网端口.

### 使用方法

添加POM依赖: 
```
<dependency>
    <groupId>cn.cyejing</groupId>
    <artifactId>fast-ngrok-starter</artifactId>
    <version>1.0.0-SNAPSHOT</version>
</dependency>
```
### 默认配置
```
ngrok.serevr-address=b.cyejing.cn 
ngrok.server-port=4443
ngrok.proto=http
ngrok.subdomain 默认为空,随机子域名
ngrok.hostname 默认为空,自定义域名
```
### 源码地址

github: [https://github.com/cyejing/fast-ngrok](https://github.com/cyejing/fast-ngrok)

欢迎提交issues和pr一起改进.😊

