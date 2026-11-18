# AdGuardHomeForRoot、FlClash 与 CFPilot 共存排障记录

[← 返回文档目录](../index.md) · [修复脚本](../examples/CFPilot-FlClash.js)

本页记录 2026-11-17 至 2026-11-18 一次真实设备排障。目标是在 **FlClash 的 Android 系统代理关闭、VPN 开启** 时，让 CFPilot 能访问外网，同时保留 AdGuardHome 的 DNS 广告拦截。文档面向使用者及后续接手的 AI；不包含订阅令牌、管理面板路径、节点凭据或原始设备日志。

## 1. 已验证的结论

最终通过 CFPilot 配置的「扩展 → 脚本」绑定 `CFPilot-FlClash`，应用后同时启用：

1. 首条规则 `AND,((DST-PORT,443),(NETWORK,UDP)),REJECT`，拒绝 QUIC 使用的 UDP 443，允许支持回退的客户端改用 TCP。
2. TLS/HTTP 域名嗅探及目标覆盖，从 TLS SNI 或 HTTP Host 恢复原始域名，用于分流与连接。

**单独增加 UDP 443 拒绝规则没有解决本次故障；增加域名嗅探后恢复。** 这证明域名信息恢复对本次修复有效，并不证明每个无法联网的 Cloudflare 节点都存在相同问题。

用户在界面创建、选择并应用脚本后，核对生成配置与实际连接：

| 验证项 | 最终结果 |
| --- | --- |
| 当前配置 | CFPilot，扩展模式为脚本，已关联用户创建的脚本 |
| Android 系统代理 | 关闭 |
| FlClash VPN | 开启，存在 TUN 网卡与本地代理监听 |
| 生效规则 | UDP 443 拒绝规则位于首条 |
| 生效嗅探 | `enable: true`，TLS 443 与 HTTP 80、8080–8880，目标覆盖开启 |
| Google `generate_204`，curl 不显式使用 HTTP 代理 | HTTP 204，约 1.33 秒 |
| YouTube 首页，同上 | HTTP 200，约 1.47 秒 |
| 百度首页，同上 | HTTP 200 |
| 浏览器 Google 搜索 | 曾实际打开并看到搜索结果 |
| 本地 AGH 查询 `ad.12306.cn`、`aaid.umeng.com` | 均返回 `0.0.0.0` |

这些结果验证了当时的联网与指定域名过滤，不能据此声称所有应用、所有 DNS 请求都经过 AGH，也不能保证未来节点可用性。

## 2. 测试环境与配置位置

| 组件 | 排障时版本/状态 |
| --- | --- |
| Android / Root | Android 17 / KernelSU / arm64 |
| AdGuardHomeForRoot | `20261027`，versionCode 55，模块 ID `AdGuardHome` |
| AdGuard Home 核心 | `v0.107.79` |
| FlClash | `0.9.3`，包名 `com.follow.clash` |
| CFPilot 客户端节点 | VLESS over WebSocket + TLS；服务端部署于 Cloudflare |
| 对照配置 | 普通机场配置，当时选中 AnyTLS 节点 |
| 文档基于的模块源码 | `40e5f5a58397e27181840d0e7ecf763d8ba95e6c` |

主要路径：

```text
/data/adb/agh/settings.conf                       模块转发设置
/data/adb/agh/bin/AdGuardHome.yaml                 AGH 核心设置
/data/adb/agh/history.log                         模块日志
/data/adb/agh/bin.log                             核心日志
/data/adb/agh/scripts/tool.sh                     start / stop / toggle
/data/data/com.follow.clash/files/config.yaml     FlClash 生成配置，只用于核查
/data/data/com.follow.clash/files/profiles/       订阅缓存，不适合保存长期覆写
/data/data/com.follow.clash/files/scripts/        FlClash 脚本文件
/data/data/com.follow.clash/files/database.sqlite 配置/脚本关联元数据
/data/data/com.follow.clash/shared_prefs/FlutterSharedPreferences.xml
                                                 App 偏好，包含 flutter.config
```

路径随版本可能变化。不要把生成配置或数据库结构当成跨版本 API；优先在界面编辑、关联和应用脚本。

## 3. 数据路径：为什么关闭系统代理后反而更能去广告

「系统代理」和「VPN」是两个不同开关。关闭 Android 系统 HTTP 代理后，FlClash 的 VPN 仍可接管应用流量。

- 遵循系统 HTTP 代理的应用通常把域名交给 FlClash 的 HTTP 入口。FlClash 可以自行解析，或将域名交给远端；本地 AGH 未必有机会过滤这次域名请求。
- 不使用系统 HTTP 代理时，应用的普通 DNS 查询可被模块的 53 端口规则接管。后续 TCP/UDP 连接仍可进入 FlClash VPN。
- FlClash 自己配置的 DoH/DoT 使用 443/853 端口，不受仅匹配 53 端口的 AGH 重定向覆盖。应用自带 DoH 也可能绕过该重定向。
- 本机观察到「系统代理关闭后去广告更好」，这是特定配置及应用路径的结果，不应推广为所有 Android/FlClash 版本的固定行为。

本次最终 **没有将 FlClash 的所有 DNS 统一改到 AGH**。FlClash 运行配置仍保留订阅提供的外部 DNS；已验证的是普通系统 DNS 的接管、指定广告域名过滤，以及 CFPilot VPN 联网。

如果要另行实现全量 DNS 串联，需要检查 `nameserver`、`nameserver-policy`、`fallback`、`direct-nameserver`、`proxy-server-nameserver`、应用自带 DNS 与循环依赖。仅在界面写一个 `127.0.0.1:5591` 并不足以证明所有请求均经过 AGH。

## 4. 问题、证据与处理结果

### 4.1 模块正常监听，但 FlClash 开启后广告变多

模块原已运行，默认 DNS/管理端口分别是 `127.0.0.1:5591` 与 `127.0.0.1:3000`。Android 私人 DNS 已关闭。直接向 AGH 查询规则内域名可得到 `0.0.0.0`；FlClash 生效 DNS 则指向外部 DoH/DoT。

处理：保留用户验证有效的「系统代理关闭、VPN 开启」路径，核对查询日志及指定广告域名，不因广告仍存在就无差别叠加规则。DNS 过滤通常不能处理与正文共域名的广告，也不能代替网页元素过滤。

排障期间规则列表曾发生变化：初期使用 AWAvenue，后续观察到 AWAvenue 禁用，而 GOODBYEADS、AdGuard DNS Filter、URLHaus 启用。这些是当时的设置快照，不能归因于本次最终脚本修复，也不是必须复制的规则组合。

### 4.2 TUN 共存与 `ignore_src_list`

按模块官方 FAQ，曾将：

```ini
ignore_src_list="172.19.0.1"
```

写入 `/data/adb/agh/settings.conf`，先备份，再停止并启动模块，确认链中存在对应的源地址 `RETURN`。

**后续实际 FlClash TUN 地址是 `198.18.0.1/30`，并向 Android 提供 DNS `198.18.0.2`。** 先前 `172.19.0.1` 来自运行中的另一个 Clash 客户端，不能当作所有 FlClash 的固定地址。

本次最终仍保留 `172.19.0.1` 的旧绕过项，没有证据证明它解决了 CFPilot 问题。不要直接把它替换成 `198.18.0.1` 并宣称修好；绕过源地址可能改变 DNS 过滤路径，应先查实际包源地址、规则计数与连接效果。

检查命令（root）：

```sh
ip -4 addr show
iptables -t nat -L ADGUARD_REDIRECT_DNS -n -v
ss -lntup
```

`ignore_src_list` 控制的是跳过 DNS 重定向，不是把节点订阅 URL 填进去。模块的 DNS 监听端口应与 `redir_port` 一致。

### 4.3 修改 FlClash prefs 后，下次打开恢复了旧值

早期在 App 停止时直接修改 XML 内 `flutter.config`，设置 `dns.enable=true`、`nameserver=["127.0.0.1:5591"]` 和 `dns-override-keys`。当时只验证了文件内容与 XML 语法，没有验证 App 重新加载后的最终配置。

之后读取到原来的 DNS 值与空覆写键，运行配置也使用订阅的外部 DNS。确切恢复原因未被证实；可能涉及 App 保存/恢复流程，但不能据此下结论。

纠正：只把**实际生成配置与真实连接**当作生效证据。不要把全局 DNS 输入框、prefs 修改成功或 XML 可解析当作最终完成。此前声称 DNS 串联已完成是不准确的。

Android SharedPreferences 的 `.bak` 文件可能参与其恢复机制。今后备份放到 App 私有配置目录之外，不建议把自定义备份也命名为原 XML 的 `.bak`。

### 4.4 普通机场能联网，CFPilot 关闭系统代理后失败

在同一个 CFPilot 节点下得到对照：

- 显式 HTTP 代理访问 Google：204，约 1.23 秒。
- 通过 VPN、没有显式 HTTP 代理：Google/YouTube TLS 握手失败。
- 当时 AGH 对 Google/YouTube 返回了一些可疑地址，VPN curl 的目标也出现异常地址。
- FlClash 嗅探关闭，可能仅拿到目标 IP，缺失恢复域名所需的信息。

这些证据支持排查「本地 DNS 得到 IP → VPN 分流/目标传递」路径。没有进一步隔离 AGH 上游、缓存、网络环境，因此不把 DNS 异常归咎于模块核心缺陷或某一家公共 DNS。

### 4.5 Cloudflare CFPilot 的 UDP 限制

排障时检查 [CFPilot 项目](https://github.com/xmwengxing/CFPilot) 的 [`_worker.js`](https://github.com/xmwengxing/CFPilot/blob/main/_worker.js)：VLESS WebSocket 的 UDP 分支仅在服务端开启 DoH 且目标端口为 53 时接受；不能据此期待任意 UDP 转发。源码会变化，后续应重新核查。

普通机场配置当时已有 UDP 443 拒绝规则，CFPilot 订阅没有。给 CFPilot 补上规则后，Google/YouTube **仍然失败**，所以 UDP/QUIC 并非本次唯一根因。该规则用于避开已知不支持的 UDP 路径；客户端能否回退 TCP 由客户端决定。

### 4.6 开启域名嗅探后恢复

在 UDP 443 拒绝规则基础上，增加 TLS/HTTP 嗅探、`parse-pure-ip`、`force-dns-mapping` 和目标覆盖后：

- VPN Google：204，约 1.09 秒。
- VPN YouTube：200，约 1.36 秒。
- 浏览器 Google 搜索出现真实结果页。

机制是从未加密的 TLS ClientHello SNI 或 HTTP Host 恢复域名；不是解密 HTTPS 正文，不需要安装 CA。使用 ECH、纯 IP 服务、其他端口或不暴露域名的协议时，不能保证同样有效。

### 4.7 修改订阅缓存会被更新覆盖；脚本要实际绑定并应用

直接编辑 `profiles/<id>.yaml` 曾验证修复，但订阅刷新会覆盖这些修改。长期方案应使用 FlClash 的扩展脚本。

排障曾尝试离线写数据库关联脚本，随后观察到关联/生效状态不符合预期；当时误判为当前版本不支持脚本。用户截图明确显示「扩展 → 脚本」，因此该判断已撤回。不能把一次绑定失败推断成版本缺少功能。

最终用户在界面新建脚本、选中并应用成功。实际元数据是脚本模式，关联用户创建的脚本，自动订阅更新保持开启；生成配置中两项修复均存在。

### 4.8 App 启动不等于 VPN 已启动

某些重启后只打开了仪表盘，VPN 未启动；这时出现 curl 超时、本地 7890 未监听、`tun0` 不存在。手机前台在操作期间也被切换过，按旧截图坐标点击不能证明点中了启动。

处理：先确认 App 运行状态、TUN、7890 监听，再解释网络测试结果。VPN 未启动时的失败不能算 CFPilot 配置失败。

## 5. 推荐修复：通过界面添加扩展脚本

脚本文件：[CFPilot-FlClash.js](../examples/CFPilot-FlClash.js)。它只添加/去重 UDP 443 拒绝规则，并合并域名嗅探设置；保留节点、DNS 和其余规则。

1. 备份 FlClash 配置。在「配置」页面长按 CFPilot，选择「扩展」。
2. 扩展模式选择「脚本」。
3. 点「前往配置脚本」，新建脚本，名称例如 `CFPilot-FlClash`。
4. 把示例文件的全部代码复制进去，替换默认模板并保存。
5. 返回扩展页，**选中该脚本名称**。仅选「脚本模式」仍可能没有绑定脚本。
6. 点「立即应用」，如 VPN 未运行，再启动 VPN。
7. 保持 Android 系统代理关闭，实际测试 Google/YouTube 及广告过滤。

只对需要修复的 CFPilot 配置绑定，不必更改正常机场配置。脚本独立于订阅缓存；更新后仍应核对扩展关联和生效配置。不要将本例覆盖目标域名功能全局强加到不相关配置。

## 6. 最小核验步骤

以下检查在手机 Termux/root 环境执行。它们不会代替浏览器实际访问测试。

### 先查运行状态

```sh
su -c 'settings get global private_dns_mode'
su -c 'ss -lntup'
su -c 'ip -4 addr show'
su -c 'iptables -t nat -L ADGUARD_REDIRECT_DNS -n -v'
```

确认 AGH 的 5591/3000、FlClash 的代理端口和 VPN 网卡。FlClash 的生成 YAML 中 `tun.enable` 可能与 Android 原生 VPN 状态不同，不能只看这一项判断 VPN 关闭。

### 核对实际生成配置

本例路径为 `/data/data/com.follow.clash/files/config.yaml`。该文件可能含节点凭据，只在本机读取所需字段，不要把整个文件贴到公开 issue。

确认：

```yaml
rules:
  - AND,((DST-PORT,443),(NETWORK,UDP)),REJECT
  # 原有规则继续保留
sniffer:
  enable: true
  override-destination: true
  force-dns-mapping: true
  parse-pure-ip: true
  sniff:
    TLS:
      ports: [443]
      override-destination: true
    HTTP:
      ports: [80, 8080-8880]
      override-destination: true
```

### 比较 VPN 与显式 HTTP 代理

```sh
curl -I --noproxy '*' --max-time 15 https://www.google.com/generate_204
curl -I --noproxy '*' --max-time 15 https://www.youtube.com
curl -I --proxy http://127.0.0.1:7890 --max-time 15 https://www.google.com/generate_204
```

不要用 `-k` 忽略证书错误来把失败变成成功。`--noproxy '*'` 排除了 curl 的显式代理使用；仍需确认应用未被 VPN 排除。

### 检查过滤

在 AGH 查询日志核对请求、命中规则及响应；也可用 `dig`（需已安装）直接查询：

```sh
dig @127.0.0.1 -p 5591 ad.12306.cn A
dig @127.0.0.1 -p 5591 aaid.umeng.com A
```

域名是否应被过滤取决于实际启用的规则，不能用一个不在列表中的域名测试后就断言过滤失效。直接向 AGH 查询成功只证明该服务器能过滤，不证明浏览器一定使用它；应同时看浏览器请求对应的日志。

## 7. 备份与回退

- 改模块前备份 `/data/adb/agh/settings.conf`、`AdGuardHome.yaml`，备份放在权限受控的目录。
- 本次设备备份存放在 `/data/adb/flclash-backups/` 下的日期目录，不应上传这些原始文件。
- 模块控制脚本只有 `start`、`stop`、`toggle`，没有 `restart`；需要重启时按顺序执行，期间会短暂影响 DNS：

```sh
su -c 'sh /data/adb/agh/scripts/tool.sh stop'
su -c 'sh /data/adb/agh/scripts/tool.sh start'
```

- 回退脚本：在 CFPilot 扩展中取消选中脚本或切回标准模式，应用后检查。若原始订阅缓存曾被直接编辑，先备份，再刷新订阅还原。
- 不覆盖整个 App 数据库来回退单个设置，以免丢失后来新增的配置。不要重启整台手机或更改服务器面板来代替有针对性的检查。

## 8. 给后续 AI 的接手说明

拿到此仓库链接后，先阅读本页和示例脚本，并遵循以下边界：

1. 先确认用户本次想修复的现象；读取现状，不把本文的 PID、TUN 地址、版本与规则列表当作当前事实。
2. 优先核对私人 DNS、AGH/FlClash 监听、VPN、当前 profile、系统代理、脚本绑定及最终生成配置。
3. 如果「HTTP 代理可用、VPN 不可用」，比较 DNS/IP、域名嗅探、分流规则、UDP 能力；别直接推断节点失效。
4. 保持有效广告过滤。不要盲目更换上游、关闭 AGH、放行全部 TUN DNS 或重置规则。
5. 修改前备份；必要的 VPN 停止/重启会断开网络，应让用户知道。优先使用界面，避免运行中改 prefs/数据库。
6. 分清「脚本存在」「已选中」「已应用」「VPN 已运行」「实际请求成功」五个状态。
7. 已有验证足够时结束，不反复重启或扩大到无关模块、其他 Android 用户空间和云端部署。
8. 不上传订阅 URL、UUID、面板路径、登录信息、数据库、完整 YAML、查询历史或原始截图。需要分享日志时先脱敏。

## 9. 本次没有做的事情

没有修改模块运行代码、重新打包 APK/模块，也没有登录或修改 CFPilot 云端管理面板。本仓库补充的是排障文档与客户端示例脚本；不是对上游模块发布了一个新修复版本。

未彻底解决或未独立验证的内容：外网 DNS 异常的具体来源、所有应用的 DNS 覆盖率、普通 UDP 应用能力、ECH 兼容性、未来节点稳定性。若这些再次出现，按上面的对照步骤收集证据，而不是把本次成功扩大为普遍保证。
