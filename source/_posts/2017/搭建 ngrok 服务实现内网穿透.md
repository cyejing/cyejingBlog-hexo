---
title : 搭建 ngrok 服务实现内网穿透
tags: [ngork]
date: 2017-09-13
---

## 搭建 ngrok 服务实现内网穿透

### 编译 ngrok

首先装必要的工具

``sudo apt-get install golang`` OR

``sudo apt-get install build-essential golang mercurial git`` 

获取 ngrok 源码：

``git clone https://github.com/inconshreveable/ngrok.git ngrok``

生成证书:

```
NGROK_DOMAIN="domain.com"

openssl genrsa -out base.key 2048
openssl req -new -x509 -nodes -key base.key -days 10000 -subj "/CN=$NGROK_DOMAIN" -out base.pem
openssl genrsa -out server.key 2048
openssl req -new -key server.key -subj "/CN=$NGROK_DOMAIN" -out server.csr
openssl x509 -req -in server.csr -CA base.pem -CAkey base.key -CAcreateserial -days 10000 -out server.crt

cp base.pem assets/client/tls/ngrokroot.crt
cp server.crt assets/server/tls/snakeoil.crt
cp server.key assets/server/tls/snakeoil.key
```

开始编译

```
make release-server
```



### 运行服务端

```
./bin/ngrokd -domain="domain.com" -httpAddr=":8081" -httpsAddr=":8082"
```

访问浏览器 ``domain.com:8081`` 当看到下面提示说明服务启动成功:

> Tunnel domain.com:8081 not found

### 运行客户端

客户端运行环境不一样需要不同的编译环境:

> Linux 平台 32 位系统：GOOS=linux GOARCH=386
>
> Linux 平台 64 位系统：GOOS=linux GOARCH=amd64
>
> Windows 平台 32 位系统：GOOS=windows GOARCH=386
>
> Windows 平台 64 位系统：GOOS=windows GOARCH=amd64
>
> MAC 平台 32 位系统：GOOS=darwin GOARCH=386
>
> MAC 平台 64 位系统：GOOS=darwin GOARCH=amd64
>
> ARM 平台：GOOS=linux GOARCH=arm

例如MAC则运行下面命令:

```
sudo GOOS=darwin GOARCH=amd64 make release-client
```

通过scp下载ngrok 到客户端:

```
scp root@0.0.0.0:/home/ubuntu/ngrok/bin/ngrok ngrok
```

在本地新建文件ngrok.cfg:

```
server_addr: “ngrok.morongs.com:4443"
trust_host_root_certs: false
```
运行命令:

```
./ngrok -subdomain demo -config=ngrok.cfg 80
```

