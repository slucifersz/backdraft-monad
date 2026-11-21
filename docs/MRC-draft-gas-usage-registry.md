# MRC 草案：链上 Gas 用量登记表（On-chain Gas Usage Registry）

- 状态：草案（Draft），尚未提交到 Monad 的提案流程
- 类型：Standards Track / 应用层
- 作者：Backdraft（Monad Blitz @ 广州，2026-11-21）
- 参考实现：[`contracts/src/Afterburner.sol`](../contracts/src/Afterburner.sol)，Monad Testnet `0xc7c9aA27aBD518AE4E321A91F33d2CB8e4338AbB`

## 摘要

定义一个链上登记表的最小接口：按“目标合约 + 函数选择器”记录一次调用真实消耗的 gas，并向任何调用方（钱包、SDK、Agent、其他合约）提供建议的 gas 上限。

## 动机

1. Monad 按交易声明的 gas 上限收费，而不是按实际消耗收费（[Gas pricing](https://docs.monad.xyz/developer-essentials/gas-pricing)）。上限设高了，多出来的部分照样付费，并占用区块空间。
2. 交易回执顶层的 `gasUsed` 等于 gas 上限，真实消耗无法从回执里读到。Category Labs 在其研究的脚注中说明了这一点，并表示正在考虑通过 RPC 公开真实消耗（[Setting your Gas Limit on Monad](https://www.category.xyz/blogs/setting-your-gas-limit-on-monad)）。
3. 同一研究指出：主网上平均 32.5% 的 gas 未被使用；按“接收合约 + 函数选择器”的历史数据设置动态余量，可以把未用比例降到约 12% 到 19%，失败率相当。这需要一份按合约和函数组织的历史用量数据，目前没有公开来源。
4. 官方文档提醒，写死的 gas 数值在 Monad 上可能不再适用，需要重新检查 `call{gas: ...}`、跨链消息执行器、ERC-4337 操作、keeper 与 relayer 的 gas 设置（[Differences](https://docs.monad.xyz/developer-essentials/differences)）。这些场景是合约在链上为其他合约设置 gas，只能读取链上数据。

## 规范

登记表合约必须（MUST）提供以下只读接口：

```solidity
interface IGasUsageRegistry {
    /// 一个函数的实测用量
    struct Stat {
        uint64 last;      // 最近一次测得的用量
        uint64 max;       // 历史最大用量
        uint64 avg;       // 指数移动平均
        uint32 count;     // 测量次数
        uint32 updatedAt; // 最近一次测量的区块时间戳
    }

    /// 读取某个合约某个函数的实测用量
    function stats(address target, bytes4 selector) external view returns (Stat memory);

    /// 建议转发给该调用的 gas：历史最大用量加固定余量；从未测量过则 samples 为 0
    function suggest(address target, bytes4 selector) external view returns (uint256 callGas, uint256 samples);

    /// 直接发送这笔调用时建议设置的交易 gas 上限（含 21,000 基础费用与 calldata 费用）；从未测量过则返回 0
    function suggestTxGasLimit(address target, bytes calldata data) external view returns (uint256 gasLimit);

    /// 同上，并返回建议值的依据。exact 为 true 表示来自这笔完全相同的调用（target + data）的记录，
    /// 为 false 表示退回到该函数（target + selector）的历史最大用量
    function suggestFor(address target, bytes calldata data)
        external view returns (uint256 gasLimit, uint256 maxUsed, uint256 samples, bool exact);

    /// 每写入一次测量时发出
    event Recorded(address indexed target, bytes4 indexed selector, uint256 gasUsed, uint256 maxGas, uint256 samples);
}
```

测量值必须（MUST）在链上取得：在对目标合约的调用前后各读取一次 `gasleft()`，两次之差即为该调用的真实消耗。登记表不应（SHOULD NOT）接受链下自报的数值。

调用失败时不应（SHOULD NOT）写入测量值。

建议余量应（SHOULD）可查询。参考实现使用 7.5%，取自 Category Labs 对固定余量的研究结论。

## 参考实现的要点

- 写入测量值所需的 gas 取自这笔交易自身的剩余 gas。这部分 gas 已经按上限付费、即将作废，所以登记表的更新没有额外的手续费成本，也不需要任何一方出资维护。
- 写入只修改登记表自己的两个存储槽（函数一份，完整调用一份），不调用其他合约，不改变调用方或目标合约的任何状态。
- 剩余 gas 不足以完成写入时直接跳过，不影响原调用。

## 已知局限

- **用量随输入变化的函数。** 同一个函数的历史最大值会被输入更大的调用抬高，对输入小的调用偏高；输入比历史更大时又会偏低。参考实现的做法是：除了按“合约 + 函数”记录，再按完整的调用数据（`keccak256(target, data)`）各记一份，建议值优先取精确匹配的记录；调用方在使用建议值之前先做一次 `eth_estimateGas`，建议值低于估算值时不采用。精确匹配只对重复出现的调用有效，更一般的方案（按 calldata 长度分桶等）留待讨论。
- **测量路径。** 参考实现通过包装入口测量，目标合约看到的调用者是登记表合约，依赖调用者身份的调用无法通过这条路径测量。可由应用自行在函数内上报，或由智能账户（ERC-4337 / EIP-7702）在执行模块中测量。
- **状态冲突。** 对同一“合约 + 函数”的并发写入会读写同一个存储槽，在并行执行下产生冲突。这类交易通常本来就访问同一个目标合约。
- **数据可信度。** 测量值来自链上执行，无法伪造数值本身；但任何人都可以用非典型的输入触发测量。是否需要区分数据来源，留待讨论。
- 如果 Monad 之后通过 RPC 公开真实消耗，链下工具可以直接取得历史数据；链上登记表对合约侧读取的场景仍然必要。

## 测试网实测

- 一笔上限为 500,000 的调用经过登记表，记录到真实用量 62,427（[交易](https://testnet.monadscan.com/tx/0x7ec501ef6ad409c0ce18f4aa5da0afa4f303c8f0a6fb755d0bfd08cb895b5c6f)）。
- `suggestTxGasLimit` 返回 88,313。同一调用不经过登记表、按该上限直接发送，执行成功（[交易](https://testnet.monadscan.com/tx/0x626c357c0be80dd8398d0670250340514f5b5149b56a960065be9903c4c5a6e6)），手续费比上限 500,000 时低 82%。
