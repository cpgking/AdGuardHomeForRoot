# 与代理软件共存

[← 返回文档目录](../index.md)

代理软件主要分为两类。

## 代理应用

如 [NekoBox](https://github.com/MatsuriDayo/NekoBoxForAndroid)、[FlClash](https://github.com/chen08209/FlClash) 等。这些应用通常具有图形化界面，便于用户配置和管理代理规则。

这类软件可手动配置 DNS：将域名解析服务器改为 `127.0.0.1:5591`，即可使用本地的 AdGuardHome 作为 DNS 服务器。

代理应用的 `分应用代理/访问控制` 功能非常实用。通过将国内应用设置为绕过模式，可以减少不必要的流量经过代理，同时这些绕过的应用仍然能够正常屏蔽广告。

## 代理模块

如 [box_for_magisk](https://github.com/taamarin/box_for_magisk)、[akashaProxy](https://github.com/akashaProxy/akashaProxy) 等。这些模块通常运行在系统层级，适合需要更高权限或更深度集成的场景。

如果使用代理模块，强烈建议禁用模块的 iptables 转发规则（将 `settings.conf` 中的 `enable_iptables` 设为 `false`）。禁用后，模块仅运行 AdGuardHome 本身。随后，将代理模块的上游 DNS 服务器配置为 `127.0.0.1:5591`，即可确保代理软件的所有 DNS 查询通过 AdGuardHome 进行广告屏蔽。

```yaml
dns:
  # ...
  default-nameserver:
    - 223.5.5.5
  nameserver:
    - 127.0.0.1:5591
  # ...
```

## FlClash 与 Cloudflare CFPilot 的实测案例

若开启系统代理时能联网、关闭系统代理后 VPN 连接失败，或开启 FlClash 后广告过滤变弱，可阅读 [完整排障记录与脚本用法](flclash-cfpilot.md)。该案例比较了 DNS/IP 与域名转发路径，并通过 CFPilot 专用扩展脚本启用域名嗅探、拒绝 UDP 443。

该修复针对已验证的客户端路径，不要求修改模块运行代码，也不代表所有 Cloudflare 节点故障都由相同原因导致。TUN 地址应读取设备现状，不要把 `172.19.0.1` 当作 FlClash 固定地址。

## 相关

- DNS 查询已经指向 AdGuardHome，但广告屏蔽仍不生效：见[常见问题](faq.md)
- 使用 FlClash 后无法访问部分网站：见[常见问题](faq.md)
