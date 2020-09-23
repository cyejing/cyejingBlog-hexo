---
title : 快速安装shadowsocks
tags : [shadowsocks]
date : 2017-09-13
---



## 快速安装shadowsocks

安装脚本:

```
wget --no-check-certificate https://raw.githubusercontent.com/teddysun/shadowsocks_install/master/shadowsocks.sh
chmod +x shadowsocks.sh
./shadowsocks.sh 2>&1 | tee shadowsocks.log
```
配置文件路径：/etc/shadowsocks.json

**卸载方法**

```
./shadowsocks.sh uninstall
```
**使用命令：**
启动：/etc/init.d/shadowsocks start
停止：/etc/init.d/shadowsocks stop
重启：/etc/init.d/shadowsocks restart
状态：/etc/init.d/shadowsocks status