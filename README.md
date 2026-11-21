# Afterburner 加力燃烧

**在 Monad 上，交易里付了钱却没用完的 gas，拿来替别人执行任务，并把赏金还给你。**

> On Monad a transaction is charged for its gas *limit*, not for the gas it uses, and nothing is refunded. Afterburner spends the leftover — gas that is already paid for and about to be thrown away — on a queue of posted jobs, and pays the job bounty back to the sender. In the demo the queued job trains a small on-chain model that predicts how much gas a call needs.

Monad Blitz @ 广州，2026-11-21。合约、脚本和文档全部在活动当天完成，赛前只有 Foundry / Next.js 的空白脚手架。

## 问题

Monad 按交易声明的 gas 上限收费，不按实际消耗收费，也不退还。这是异步执行带来的设计：区块在执行之前就已经排好，协议只能按上限预留容量。

- Category Labs 统计了主网一周的 766 万笔成功交易，**平均 32.5% 的 gas 付了钱没有用到**（[原文](https://www.category.xyz/blogs/setting-your-gas-limit-on-monad)）。文章把它称为拖累整条链的无谓损失：区块容量被占了，却没有执行任何东西。
- 同一篇文章指出，为了防止交易失败，上限至少要留 7.5% 左右的余量。也就是说，**有一部分浪费设得再精确也消除不了**。
- 我们在 11 月 21 日抽样复核：主网连续 7 个区块的 158 笔交易，扣掉一成余量后，38% 的手续费付给了不需要的 gas（样本很小，且其中 74% 的浪费来自同一个竞价合约，仅作旁证）。
- 回执和区块浏览器上的 `gasUsed` 显示的就是上限值，所以发送者看不到自己的调用实际用了多少。

## 做法

Afterburner 是一个链上的任务队列，加一个包装入口。

1. **挂任务。** 任何人可以登记一个任务合约并押一笔赏金，按任务实际消耗的 gas 计价。任务合约只需要实现一个函数 `work()`：拿到多少 gas 就做多少事，返回完成的工作量。
2. **回收。** 发送者通过 `exec(target, data)` 发起自己的调用。调用结束后，合约用 `gasleft()` 查出还剩多少 gas，在留足收尾余量的前提下依次执行队列里的任务，赏金直接付给发送者。
3. **失败也回收。** 如果发送者自己的调用失败了，交易不回滚，剩余的 gas 照样用来执行任务。在 Monad 上失败的交易同样按上限全额扣费，这是最冤的一种多付。

应用合约不需要做任何改动。也可以选择在自己函数的末尾调用 `burn(beneficiary)` 直接接入。

### 为什么只在 Monad 上成立

以太坊按实际消耗收费，没用完的 gas 会退回，不存在"已经付过钱的剩余"。只有在按上限收费的链上，剩余的 gas 才是边际成本为零的资源：执行任务的人不需要像普通的任务执行者那样另外花钱发交易。

### 它不鼓励多留 gas

每单位 gas 的赏金被合约限制在该笔交易 gas 价格的 90% 以内（`MAX_REFUND_BPS`），所以拿回的永远少于多付的。把上限设紧仍然是最划算的做法，Afterburner 回收的是不得不留的那部分安全余量，以及没有被设紧的那些交易。

## 演示里的任务：用浪费的 gas 训练一个预测 gas 的模型

队列里有两个任务：

- **Heartbeat**：最简单的一类任务，只需要有人隔一段时间触发一次。
- **GasModel**：一个完全在链上训练的线性模型 `gas ≈ w·n + b`，学习"输入规模为 n 的调用需要多少 gas"。每一步梯度下降都由别人交易里剩余的 gas 支付。训练数据是演示应用在 16 种输入规模下实测的 gas。

这个模型很小（两个参数），它的作用是让人看见剩余的 gas 确实完成了真实的计算。选它是因为链上训练耗 gas 多又不赶时间，正适合搭顺风车。

## 当天实测（Monad 测试网）

同一个调用（演示应用 `crunch(8)`，自身需要约 6.2 万 gas），用不同的上限通过 Afterburner 发出：

| 上限的设法 | gas 上限 | 回收执行的 gas | 训练步数 | 手续费 (MON) | 赚回 (MON) | 赚回比例 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 官方建议：估算值 +7.5% | 114,037 | 0 | 0 | 0.01152 | 0 | 0% |
| 钱包默认：估算值 ×1.5 | 159,121 | 0 | 0 | 0.01607 | 0 | 0% |
| 写死 300,000 | 300,000 | 126,377 | 7 | 0.03030 | 0.00632 | 20.9% |
| 写死 500,000 | 500,000 | 323,478 | 26 | 0.05050 | 0.01617 | 32.0% |
| 调用失败，上限 300,000 | 300,000 | 179,069 | 14 | 0.03030 | 0.00895 | 29.5% |

- 上限设得紧的交易没有可回收的，也不需要回收，这符合预期。
- 模型从零开始，经过 191 步训练，误差从 0.40 降到 0.000003；对 `n = 8` 的预测是 73,980 gas，实测值是 74,081，相差 0.14%。
- 截至 11 月 21 日 14:27：累计回收 20 笔交易、360 万 gas、273 个工作单位，付出赏金 0.18 MON。
- 每一笔的哈希和明细在 [`web/public/data/runs.json`](web/public/data/runs.json)。

合约在链上量出了每笔交易的真实分段（`Burned` 事件）：自己的调用用了多少、回收了多少、还剩多少。区块浏览器上这些交易的 `gasUsed` 一律显示为上限值。

## 合约（Monad Testnet，chainId 10143，源码已验证）

| 合约 | 地址 |
| --- | --- |
| Afterburner（队列与包装入口） | [`0xAF019654d479917bd38ADa0648eb9AdbFfc6db79`](https://testnet.monadscan.com/address/0xAF019654d479917bd38ADa0648eb9AdbFfc6db79) |
| GasModel（链上训练的模型） | [`0x54e95229e1259D1A16E9f242f9816413bF9634b1`](https://testnet.monadscan.com/address/0x54e95229e1259D1A16E9f242f9816413bF9634b1) |
| DemoApp（代表一个普通应用） | [`0x9097f732659811c4119a28B887ED8f829E11a7A5`](https://testnet.monadscan.com/address/0x9097f732659811c4119a28B887ED8f829E11a7A5) |
| Heartbeat（最简单的任务） | [`0xc02fd9FC8aE928555f8F0672709D24EAa8fe3251`](https://testnet.monadscan.com/address/0xc02fd9FC8aE928555f8F0672709D24EAa8fe3251) |

## 安全性

测试覆盖了以下情况（`contracts/test/Afterburner.t.sol`，7 项全部通过）：

- 任务把给它的 gas 全部耗尽、返回超大数据、或者试图重入队列，都不会让发送者自己的调用失败。
- 发送者的调用失败时，交易不回滚，剩余的 gas 仍然被回收。
- 赏金不会超过回收的 gas 所花费用的 90%。
- 上限设紧时不执行任何任务。
- 任务连续失败 3 次会被自动停用。

## 已知的局限

如实说明，这是一个机制演示，不是可以直接上线的产品：

- **任务什么时候被执行不确定。** 取决于有没有带剩余 gas 的交易经过，只适合不赶时间的操作，例如结算、复利、批量发放。
- **包装入口会改变调用者。** 通过 `exec` 发起时，目标合约看到的调用者是 Afterburner，依赖调用者身份的应用不能直接这样用。正式的形态应当是智能账户（ERC-4337 / EIP-7702）里的一个执行模块，让用户自己的账户在交易末尾回收，调用者不变。今天没有做。
- **并行执行。** 所有经过队列的交易都会读写队列和任务合约的状态，彼此冲突，在 Monad 上会被串行重新执行。训练这类有先后顺序的任务无法避免这一点。
- **固定开销。** 在 Monad 上读一个冷存储槽要 8,100 gas。回收一次的固定开销约 5 万 gas，所以剩余少于约 9 万 gas 的交易回收不到东西。我们把模型的训练数据压进两个存储槽，把单次训练的固定开销从约 9 万降到约 4 万。
- **未经审计。** 只在测试网上运行过。

## 仓库结构

```
contracts/   Foundry 工程：Afterburner、GasModel、DemoApp、测试、部署脚本
web/         Next.js 前端；src/lib/chain.ts 是读合约、模拟、发交易的数据层
web/scripts/ afterburn.ts 命令行
skills/      给编码 Agent 用的 skill
```

## 运行

合约测试：

```bash
cd contracts && forge test -vv
```

命令行（需要 Node 24；签名私钥放在环境变量 `AFTERBURNER_KEY`）：

```bash
cd web && pnpm install
node scripts/afterburn.ts status
node scripts/afterburn.ts sim  --crunch 8 --gas 300000
node scripts/afterburn.ts send --crunch 8 --gas 300000
node scripts/afterburn.ts send --to <合约地址> --data <calldata> --gas <上限>
```

每条命令输出一个 JSON 对象，方便 Agent 解析。

## 给 Agent 用

自己构造交易的脚本、机器人和 Agent 没有钱包替它们设上限，是多付 gas 最多的一类发送者。[`skills/afterburner/SKILL.md`](skills/afterburner/SKILL.md) 让编码 Agent 在 Monad 上发交易时先模拟、再决定上限，剩余部分走 Afterburner。

## 参考

- Category Labs，[Setting your Gas Limit on Monad](https://www.category.xyz/blogs/setting-your-gas-limit-on-monad)（2026-02-23）
- Monad 文档，[Gas pricing](https://docs.monad.xyz/developer-essentials/gas-pricing)、[Wallet developers](https://docs.monad.xyz/developer-essentials/wallet-developers)
- Monad 论坛，[Idea: 15% gas spend buffer](https://forum.monad.xyz/t/idea-15-gas-spend-buffer/394)

## License

MIT
