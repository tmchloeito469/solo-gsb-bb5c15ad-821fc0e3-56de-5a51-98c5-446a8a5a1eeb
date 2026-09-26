// 求解器单元测试：node test/solver.test.mjs
// 先用 tsc 将 src/solver.ts 编译到临时目录，再运行断言。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const outDir = mkdtempSync(join(tmpdir(), 'solver-test-'));
execFileSync('npx', ['tsc', 'src/solver.ts', '--outDir', outDir, '--module', 'ES2020', '--target', 'ES2020', '--moduleResolution', 'bundler', '--skipLibCheck'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'inherit',
});
// tsc 输出为 ESM 但无 package.json 类型声明，改名为 .mjs 以便 import
const { renameSync } = await import('node:fs');
renameSync(join(outDir, 'solver.js'), join(outDir, 'solver.mjs'));
const solver = await import(pathToFileURL(join(outDir, 'solver.mjs')).href);

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const network = {
  nodes: ['S1', 'S2', 'N1', 'N2', 'N3', 'N4', 'A', 'B', 'C', 'D'],
  pipes: [
    { id: 'P1', from: 'A', to: 'N2' },
    { id: 'P2', from: 'C', to: 'N3' },
  ],
  valvedPipes: [
    { id: 'V01', from: 'S1', to: 'N1', open: true },
    { id: 'V02', from: 'S2', to: 'N4', open: true },
    { id: 'V03', from: 'N1', to: 'N2', open: true },
    { id: 'V04', from: 'N2', to: 'N3', open: true },
    { id: 'V05', from: 'N3', to: 'N4', open: true },
    { id: 'V06', from: 'N4', to: 'N1', open: true },
    { id: 'V07', from: 'D', to: 'N3', open: true },
    { id: 'V08', from: 'B', to: 'N1', open: true },
    { id: 'V09', from: 'B', to: 'N4', open: false },
  ],
};
const query = { supplies: ['S1', 'S2'], leak: 'N2', outlets: ['B', 'C', 'D'] };

console.log('基本求解：');
const r1 = solver.solve(network, query);
check('返回 ok', r1.status === 'ok');
check('最少关阀数为 2', r1.minClosed === 2);
check('唯一最优方案为 [V03, V04]', r1.solutions.length === 1 && r1.solutions[0].closed.join(',') === 'V03,V04');
check('漏点已隔离', r1.solutions[0].leakIsolated === true);
check('全部出口连通', r1.solutions[0].outletStatus.every((o) => o.connected));
check('出口 B 可达 S1', r1.solutions[0].outletStatus.find((o) => o.outlet === 'B').reachableSupplies.includes('S1'));

console.log('输入不被修改：');
const before = JSON.stringify(network);
solver.solve(network, query);
check('求解后 network 未变化', JSON.stringify(network) === before);

console.log('无需关阀（漏点本就隔离）：');
const r2 = solver.solve(network, { supplies: ['S1'], leak: 'D', outlets: ['A'] });
// D 通过 V07 连到 N3... S1 可达 N3，所以 D 并未隔离 —— 构造真正隔离的场景：
const isoNet = {
  nodes: ['S1', 'X', 'Y'],
  pipes: [],
  valvedPipes: [
    { id: 'V1', from: 'S1', to: 'X', open: true },
    { id: 'V2', from: 'Y', to: 'X', open: false },
  ],
};
const r2b = solver.solve(isoNet, { supplies: ['S1'], leak: 'Y', outlets: ['X'] });
check('漏点已天然隔离时关阀数为 0', r2b.status === 'ok' && r2b.minClosed === 0 && r2b.solutions[0].closed.length === 0);
void r2;

console.log('无解场景：');
const r3 = solver.solve(network, { supplies: ['S1', 'S2'], leak: 'N2', outlets: ['A'] });
check('保供出口与漏点同管段时无解', r3.status === 'no-solution');

console.log('字典序取舍：');
// S—V1—M—V2—L 为串联：关闭 V1 或 V2 都能隔离漏点，
// 两个等价的最小方案 [V1] 与 [V2]，字典序应优先 [V1]
const tieNet = {
  nodes: ['S', 'M', 'L', 'O'],
  pipes: [],
  valvedPipes: [
    { id: 'V2', from: 'M', to: 'L', open: true },
    { id: 'V1', from: 'S', to: 'M', open: true },
    { id: 'V3', from: 'O', to: 'S', open: true },
  ],
};
const r4 = solver.solve(tieNet, { supplies: ['S'], leak: 'L', outlets: ['O'] });
check('并列方案均列出且按字典序排列', r4.status === 'ok' && r4.minClosed === 1 &&
  r4.solutions.length === 2 && r4.solutions[0].closed[0] === 'V1' && r4.solutions[1].closed[0] === 'V2');

console.log('校验：');
const r5 = solver.solve(network, { supplies: ['S1', 'N2'], leak: 'N2', outlets: [] });
check('漏点不能是供水点', r5.status === 'invalid');
const dup = solver.parseNetwork({ nodes: ['a', 'b'], pipes: [], valvedPipes: [
  { id: 'V1', from: 'a', to: 'b', open: true },
  { id: 'V1', from: 'b', to: 'a', open: true },
] });
check('阀门编号重复被拒绝', !dup.network && dup.errors.some((e) => e.includes('重复')));
const many = solver.parseNetwork({
  nodes: ['a', 'b'],
  pipes: [],
  valvedPipes: Array.from({ length: 13 }, (_, i) => ({ id: `V${i}`, from: 'a', to: 'b', open: true })),
});
const r6 = solver.solve(many.network, { supplies: ['a'], leak: 'b', outlets: [] });
check('超过 12 个开启阀门被拒绝', r6.status === 'invalid' && r6.errors.some((e) => e.includes('13')));

// ============ 保供韧性巡检 ============
console.log('保供韧性巡检：');

const findRow = (r, name) => r.rows.find((x) => x.outlet === name);

const ir1 = solver.inspectResilience(network, { supplies: ['S1', 'S2'], leak: 'N2', outlets: ['B', 'C', 'D', 'N2'] });
check('返回 ok', ir1.status === 'ok');
// B：V08 与 V09(已关) 并行，仅 V08 可用 → 1
const iB = findRow(ir1, 'B');
check('出口 B 至少需失效 1 条（已关阀不参与）', iB.assessable && iB.minFailures === 1 && iB.witnessPipes.join(',') === 'V08');
// C：经单条无阀管段 P2 挂在环上 → 1（无阀管段按单条计）
const iC = findRow(ir1, 'C');
check('出口 C 至少需失效 1 条（无阀管段 P2）', iC.assessable && iC.minFailures === 1 && iC.witnessPipes.join(',') === 'P2');
// D：仅 V07 单管 → 1
const iD = findRow(ir1, 'D');
check('出口 D 至少需失效 1 条', iD.assessable && iD.minFailures === 1 && iD.witnessPipes.join(',') === 'V07');
// N2 位于环路中：须同时切断 V03、V04 两条管段
const iN2 = findRow(ir1, 'N2');
check('环路上的 N2 至少需失效 2 条（环路分别计数）', iN2.assessable && iN2.minFailures === 2 && iN2.witnessPipes.join(',') === 'V03,V04');
check('结果按失效数升序（1,1,1,2）', ir1.rows.map((x) => x.minFailures).join(',') === '1,1,1,2');
check('参与计数管段数（2 无阀 + 8 开启阀门，排除已关 V09）', ir1.activePipeCount === 10);

console.log('巡检：已断水出口为 0 和空清单：');
// 仅经一条关闭阀门挂在网上的出口
const cutNet = {
  nodes: ['S', 'X', 'O'],
  pipes: [],
  valvedPipes: [
    { id: 'V1', from: 'S', to: 'X', open: true },
    { id: 'V2', from: 'X', to: 'O', open: false },
  ],
};
const ir2 = solver.inspectResilience(cutNet, { supplies: ['S'], leak: '', outlets: ['O'] });
const r2row = ir2.rows[0];
check('已断水出口 minFailures=0', r2row.assessable && r2row.minFailures === 0);
check('已断水出口为空清单', Array.isArray(r2row.witnessPipes) && r2row.witnessPipes.length === 0);
check('已断水出口标记 alreadyCut', r2row.alreadyCut === true);

console.log('巡检：并行管段分别计数：');
const parNet = {
  nodes: ['S', 'O'],
  pipes: [
    { id: 'P1', from: 'S', to: 'O' },
    { id: 'P2', from: 'S', to: 'O' },
  ],
  valvedPipes: [
    { id: 'V1', from: 'S', to: 'O', open: true },
  ],
};
const ir3 = solver.inspectResilience(parNet, { supplies: ['S'], leak: '', outlets: ['O'] });
const r3row = ir3.rows[0];
check('3 条并行管段 → 需失效 3 条', r3row.assessable && r3row.minFailures === 3);
check('割清单含全部 3 条并行管段', r3row.witnessPipes.length === 3 &&
  ['P1', 'P2', 'V1'].every((p) => r3row.witnessPipes.includes(p)));

console.log('巡检：多供水点作为整体：');
// O 经 P1 连 S1、经 V1 连 S2：必须两条都失效才失去全部供水
const multiNet = {
  nodes: ['S1', 'S2', 'O'],
  pipes: [{ id: 'P1', from: 'S1', to: 'O' }],
  valvedPipes: [{ id: 'V1', from: 'S2', to: 'O', open: true }],
};
const ir4 = solver.inspectResilience(multiNet, { supplies: ['S1', 'S2'], leak: '', outlets: ['O'] });
check('双供水点分别单管接入 → 需失效 2 条', ir4.rows[0].minFailures === 2);
const ir4b = solver.inspectResilience(multiNet, { supplies: ['S1'], leak: '', outlets: ['O'] });
check('只算一个供水点时 → 需失效 1 条', ir4b.rows[0].minFailures === 1);

console.log('巡检：出口与供水点同名：');
const ir5 = solver.inspectResilience(network, { supplies: ['S1'], leak: '', outlets: ['S1', 'B'] });
const same = findRow(ir5, 'S1');
check('同名出口标记无法评估', same.assessable === false && same.reason.includes('无法按管段失效评估'));
check('无法评估排在升序结果最后', ir5.rows[1].outlet === 'S1');

console.log('巡检：无阀管段按单条计且能出现在割中：');
const pNet = {
  nodes: ['S', 'M', 'O'],
  pipes: [{ id: 'P1', from: 'M', to: 'O' }],
  valvedPipes: [{ id: 'V1', from: 'S', to: 'M', open: true }],
};
const ir6 = solver.inspectResilience(pNet, { supplies: ['S'], leak: '', outlets: ['O'] });
check('串联无阀管段场景需失效 1 条', ir6.rows[0].minFailures === 1);
check('割可以是无阀管段 P1 或带阀管段 V1', ['P1', 'V1'].includes(ir6.rows[0].witnessPipes[0]));

console.log('巡检：校验与纯函数：');
const ir7 = solver.inspectResilience(network, { supplies: ['NOPE'], leak: '', outlets: ['B'] });
check('供水点不存在时报错', ir7.status === 'invalid');
const ir8 = solver.inspectResilience(network, { supplies: ['S1'], leak: '', outlets: ['NOPE'] });
check('出口不存在时报错', ir8.status === 'invalid');
const ir9 = solver.inspectResilience(network, { supplies: [], leak: '', outlets: ['B'] });
check('缺少供水点时报错', ir9.status === 'invalid');
const beforeInsp = JSON.stringify(network);
solver.inspectResilience(network, { supplies: ['S1', 'S2'], leak: '', outlets: ['B', 'C'] });
check('巡检不修改输入网络', JSON.stringify(network) === beforeInsp);
// 不受 12 个开启阀门上限影响（巡检为多项式最大流，非组合枚举）
const ir10 = solver.inspectResilience(many.network, { supplies: ['a'], leak: '', outlets: ['b'] });
check('巡检不受开启阀门 12 个上限影响', ir10.status === 'ok' && ir10.rows[0].minFailures === 13);

// ============ 供水能力核验 ============
console.log('供水能力核验：');

const cap = (supplies, outlets, supplyCaps, outletDemands) =>
  solver.verifyCapacity(network, { supplies, outlets, supplyCaps, outletDemands });
const capRow = (r, name) => r.rows.find((x) => x.outlet === name);
const capKinds = (r) => r.cutItems.map((c) => `${c.kind}:${c.id}=${c.capacity}`).join('|');

// 基本场景：S1/S2 各仅一条单位管接入环网（V01/V02），总入环能力 2；
// B 挂单管 V08（V09 已关）最多获配 1
const c1 = cap(
  ['S1', 'S2'],
  ['B', 'C', 'D'],
  { S1: 5, S2: 3 },
  { B: 2, C: 1, D: 1 }
);
check('核验返回 ok', c1.status === 'ok');
check('总获配为 2（受两条供水接入管 V01/V02 限制）', c1.totalAllocated === 2);
check('总缺口为 2（B 缺 1、C 或 D 缺 1）', c1.totalShortfall === 2);
check('B 获配 1、缺口 1（V09 已关，仅 V08 单管）', capRow(c1, 'B').allocated === 1 && capRow(c1, 'B').shortfall === 1);
check('C、D 合计获配 1', capRow(c1, 'C').allocated + capRow(c1, 'D').allocated === 1);
check('最小割容量合计等于总获配', c1.cutCapacity === 2);
check('最小割为两条供水接入管 V01、V02', c1.cutItems.length === 2 &&
  c1.cutItems.every((x) => x.kind === 'pipe') &&
  c1.cutItems.map((x) => x.id).sort().join(',') === 'V01,V02');
check('割中不含已关阀 V09', !c1.cutItems.some((x) => x.id === 'V09'));

console.log('核验：供给上限成为瓶颈：');
// 供水点直接以并行大通道接出（13 条并行单位管），出口需求很大，
// 此时总获配只受供给上限制约
const bigNet = {
  nodes: ['SA', 'SB', 'O'],
  pipes: [],
  valvedPipes: [
    ...Array.from({ length: 13 }, (_, i) => ({ id: `VA${i}`, from: 'SA', to: 'O', open: true })),
    ...Array.from({ length: 13 }, (_, i) => ({ id: `VB${i}`, from: 'SB', to: 'O', open: true })),
  ],
};
const c2 = solver.verifyCapacity(bigNet, {
  supplies: ['SA', 'SB'], outlets: ['O'],
  supplyCaps: { SA: 2, SB: 1 }, outletDemands: { O: 100 },
});
check('总获配受限于供给上限合计 3', c2.totalAllocated === 3);
check('最小割为两条供给上限（容量 2+1）', c2.cutItems.length === 2 &&
  c2.cutItems.every((x) => x.kind === 'supply') && c2.cutCapacity === 3);

console.log('核验：出口需求成为瓶颈（全部足额）：');
const c3net = {
  nodes: ['SA', 'SB', 'OA', 'OB', 'OC'],
  pipes: [],
  valvedPipes: [
    ...Array.from({ length: 9 }, (_, i) => ({ id: `VA${i}`, from: 'SA', to: 'OA', open: true })),
    ...Array.from({ length: 9 }, (_, i) => ({ id: `VB${i}`, from: 'SB', to: 'OB', open: true })),
    ...Array.from({ length: 9 }, (_, i) => ({ id: `VC${i}`, from: 'SA', to: 'OC', open: true })),
  ],
};
const c3 = solver.verifyCapacity(c3net, {
  supplies: ['SA', 'SB'], outlets: ['OA', 'OB', 'OC'],
  supplyCaps: { SA: 5, SB: 5 }, outletDemands: { OA: 1, OB: 1, OC: 1 },
});
check('总获配等于总需求 3', c3.totalAllocated === 3 && c3.totalShortfall === 0);
check('最小割为三个出口需求', c3.cutItems.length === 3 &&
  c3.cutItems.every((x) => x.kind === 'demand') && c3.cutCapacity === 3);
check('全部出口标记足额', c3.rows.every((x) => x.fullySupplied));

console.log('核验：已关阀不参与、断水出口获配 0：');
const cutCapNet = {
  nodes: ['S', 'X', 'O'],
  pipes: [],
  valvedPipes: [
    { id: 'V1', from: 'S', to: 'X', open: true },
    { id: 'V2', from: 'X', to: 'O', open: false },
  ],
};
const c4 = solver.verifyCapacity(cutCapNet, {
  supplies: ['S'], outlets: ['O'],
  supplyCaps: { S: 5 }, outletDemands: { O: 3 },
});
check('仅经已关阀连接时获配 0、缺口 3', c4.status === 'ok' &&
  c4.totalAllocated === 0 && c4.rows[0].allocated === 0 && c4.rows[0].shortfall === 3);
check('参与输水管段仅 1 条（V2 已关排除）', c4.activePipeCount === 1);
check('总获配 0 时割清单为空', c4.cutItems.length === 0 && c4.cutCapacity === 0);

console.log('核验：同一无向管段双向合计只能占用一次：');
// S1—M—S2 为一条单位管，O 从 M 经一条单位管取水：
// 无论 S1、S2 上限多大，M→O 单管使每个出口侧最多 1；
// 关键：S1 与 S2 之间的共享管段不能同时双向各占 1
const sharedNet = {
  nodes: ['S1', 'S2', 'M', 'O'],
  pipes: [{ id: 'P1', from: 'M', to: 'O' }],
  valvedPipes: [
    { id: 'V1', from: 'S1', to: 'M', open: true },
    { id: 'V2', from: 'S2', to: 'M', open: true },
  ],
};
const c5 = solver.verifyCapacity(sharedNet, {
  supplies: ['S1', 'S2'], outlets: ['O'],
  supplyCaps: { S1: 5, S2: 5 }, outletDemands: { O: 5 },
});
check('两个供水点合计最多经 P1 供出 1', c5.totalAllocated === 1);
check('最小割为管段 P1', c5.cutItems.length === 1 && c5.cutItems[0].kind === 'pipe' && c5.cutItems[0].id === 'P1');

console.log('核验：环路提供两条单位通道：');
// S—N1—N2—O 与 S—N3—N2—O 构成双路径 → O 最多获配 2
const ringNet = {
  nodes: ['S', 'N1', 'N3', 'N2', 'O'],
  pipes: [{ id: 'P1', from: 'N2', to: 'O' }],
  valvedPipes: [
    { id: 'V1', from: 'S', to: 'N1', open: true },
    { id: 'V2', from: 'N1', to: 'N2', open: true },
    { id: 'V3', from: 'S', to: 'N3', open: true },
    { id: 'V4', from: 'N3', to: 'N2', open: true },
  ],
};
const c6 = solver.verifyCapacity(ringNet, {
  supplies: ['S'], outlets: ['O'],
  supplyCaps: { S: 9 }, outletDemands: { O: 9 },
});
check('双路径 + 出口单管 → 获配 1（P1 瓶颈）', c6.totalAllocated === 1 &&
  c6.cutItems.some((x) => x.kind === 'pipe' && x.id === 'P1'));
// 出口再加一条并行管 → 2
const ringNet2 = {
  nodes: ['S', 'N1', 'N3', 'N2', 'O'],
  pipes: [
    { id: 'P1', from: 'N2', to: 'O' },
    { id: 'P2', from: 'N1', to: 'O' },
  ],
  valvedPipes: ringNet.valvedPipes,
};
const c7 = solver.verifyCapacity(ringNet2, {
  supplies: ['S'], outlets: ['O'],
  supplyCaps: { S: 9 }, outletDemands: { O: 9 },
});
check('环路两路径 + 两并行出口管 → 获配 2', c7.totalAllocated === 2 && c7.cutCapacity === 2);

console.log('核验：零上限 / 零需求：');
const c8 = cap(['S1', 'S2'], ['B', 'C'], { S1: 0, S2: 0 }, { B: 2, C: 2 });
check('供给上限全为 0 时获配 0', c8.totalAllocated === 0);
check('零上限弧不进入割清单', c8.cutItems.length === 0);
const c9 = cap(['S1'], ['B', 'C'], { S1: 5 }, { B: 0, C: 0 });
check('需求全为 0 时获配 0、缺口 0', c9.totalAllocated === 0 && c9.totalShortfall === 0);
check('零需求弧不进入割清单', c9.cutItems.length === 0);
// 混合：B 需求 0（挂在 S1 旁），C 经单管需求 2 → 割只含管段，不含零需求 B
const zeroMixNet = {
  nodes: ['S1', 'B', 'C'],
  pipes: [],
  valvedPipes: [
    { id: 'V0', from: 'S1', to: 'B', open: true },
    { id: 'V1', from: 'S1', to: 'C', open: true },
  ],
};
const c9b = solver.verifyCapacity(zeroMixNet, {
  supplies: ['S1'], outlets: ['B', 'C'],
  supplyCaps: { S1: 5 }, outletDemands: { B: 0, C: 2 },
});
check('零需求出口不产生割项，瓶颈仅为 V1', c9b.totalAllocated === 1 &&
  c9b.cutItems.map((x) => x.id).join(',') === 'V1');

console.log('核验：纯函数与输入校验：');
const beforeCap = JSON.stringify(network);
cap(['S1', 'S2'], ['B'], { S1: 2, S2: 2 }, { B: 3 });
check('核验不修改输入网络与数值表', JSON.stringify(network) === beforeCap);
const ce1 = cap(['NOPE'], ['B'], { NOPE: 1 }, { B: 1 });
check('供水点不存在时报错', ce1.status === 'invalid');
const ce2 = cap(['S1'], ['NOPE'], { S1: 1 }, { NOPE: 1 });
check('出口不存在时报错', ce2.status === 'invalid');
const ce3 = cap([], ['B'], {}, { B: 1 });
check('缺少供水点时报错', ce3.status === 'invalid');
const ce4 = cap(['S1'], [], { S1: 1 }, {});
check('缺少出口时报错', ce4.status === 'invalid');
const ce5 = cap(['S1'], ['B'], { S1: -1 }, { B: 1 });
check('负整数上限被拒绝', ce5.status === 'invalid' && ce5.errors.some((e) => e.includes('非负整数')));
const ce6 = cap(['S1'], ['B'], { S1: 1.5 }, { B: 1 });
check('小数上限被拒绝', ce6.status === 'invalid');
const ce7 = cap(['S1'], ['B'], {}, { B: 1 });
check('缺少某供水点上限被拒绝', ce7.status === 'invalid');
const ce8 = cap(['S1'], ['B'], { S1: 1 }, { B: '2' });
check('字符串需求量被拒绝', ce8.status === 'invalid');

// ============ 重点出口优先配水 ============
console.log('重点出口优先配水：');

const prio = (supplies, outlets, priorityOutlets, supplyCaps, outletDemands) =>
  solver.verifyPriorityCapacity(network, { supplies, outlets, supplyCaps, outletDemands, priorityOutlets });
const prioRow = (r, name) => r.rows.find((x) => x.outlet === name);

// 与核验同一数值（c1）：总入环能力 V01/V02 = 2，B 挂单管 V08 最多 1
const p0 = prio(['S1', 'S2'], ['B', 'C', 'D'], [], { S1: 5, S2: 3 }, { B: 2, C: 1, D: 1 });
check('未选重点时返回 ok', p0.status === 'ok');
check('未选重点时第一级目标值为 0', p0.priorityAllocated === 0 && p0.priorityOutletCount === 0);
check('未选重点时总获配与普通核验一致（2）', p0.totalAllocated === c1.totalAllocated);
check('未选重点时全部行标记为普通', p0.rows.every((x) => x.category === 'normal'));
check('未选重点时普通获配即总获配', p0.normalAllocated === 2);

const p1 = prio(['S1', 'S2'], ['B', 'C', 'D'], ['B'], { S1: 5, S2: 3 }, { B: 2, C: 1, D: 1 });
check('B 为重点时返回 ok', p1.status === 'ok');
check('第一级：B 受单管 V08 限制最多获配 1', p1.priorityAllocated === 1 && prioRow(p1, 'B').allocated === 1);
check('第二级：总获配仍为 2（重点不减）', p1.totalAllocated === 2);
check('第二级增量全部给普通出口（C+D=1）', p1.normalAllocated === 1 &&
  prioRow(p1, 'C').allocated + prioRow(p1, 'D').allocated === 1);
check('行类别标记正确', prioRow(p1, 'B').category === 'priority' &&
  prioRow(p1, 'C').category === 'normal' && prioRow(p1, 'D').category === 'normal');
check('B 缺口 1、重点缺口合计 1', prioRow(p1, 'B').shortfall === 1 && p1.priorityShortfall === 1);

// C、D 为重点：普通核验中 B 会占掉 1 个入环单位；优先配水应把两个入环单位
// 全部让给 C、D（各 1），普通出口 B 获配 0
const p2 = prio(['S1', 'S2'], ['B', 'C', 'D'], ['C', 'D'], { S1: 5, S2: 3 }, { B: 2, C: 1, D: 1 });
check('第一级：C、D 合计获配 2（优先于 B）', p2.priorityAllocated === 2 &&
  prioRow(p2, 'C').allocated === 1 && prioRow(p2, 'D').allocated === 1);
check('重点已足额（重点缺口 0）', p2.priorityShortfall === 0);
check('第二级：总获配 2，普通出口 B 让管获配 0', p2.totalAllocated === 2 && prioRow(p2, 'B').allocated === 0);
check('总缺口仍为 2（B 缺 2）', p2.totalShortfall === 2);

console.log('优先配水：第二阶段经残量网络改派已有流量（避免虚假缺口）：');
// S 经 su/sv 两条单位管分别接 u、v；P（重点）可由 u 或 v 供水，C（普通）只能由 u 供水。
// 第一阶段最大流取 S→u→P 占住 su 与 up；第二阶段增广路 S→v→P→u→C 穿过重点流的反向弧，
// 把 P 改派到 v 侧、腾出 u 侧给 C：重点仍为 1，总获配 2。
// 若逐出口占管且不允许改派，会错误报出 C 缺口 1（总获配仅 1）。
const rerouteNet = {
  nodes: ['S', 'u', 'v', 'P', 'C'],
  pipes: [],
  valvedPipes: [
    { id: 'su', from: 'S', to: 'u', open: true },
    { id: 'sv', from: 'S', to: 'v', open: true },
    { id: 'up', from: 'u', to: 'P', open: true },
    { id: 'vp', from: 'v', to: 'P', open: true },
    { id: 'uc', from: 'u', to: 'C', open: true },
  ],
};
const p3 = solver.verifyPriorityCapacity(rerouteNet, {
  supplies: ['S'], outlets: ['P', 'C'], priorityOutlets: ['P'],
  supplyCaps: { S: 5 }, outletDemands: { P: 1, C: 1 },
});
const p3plain = solver.verifyCapacity(rerouteNet, {
  supplies: ['S'], outlets: ['P', 'C'],
  supplyCaps: { S: 5 }, outletDemands: { P: 1, C: 1 },
});
check('残量改派场景返回 ok', p3.status === 'ok');
check('第一级重点 P 获配 1', p3.priorityAllocated === 1 && prioRow(p3, 'P').allocated === 1);
check('第二级经改派后普通 C 也获配 1（无虚假缺口）', prioRow(p3, 'C').allocated === 1);
check('总获配为 2，与无重点普通核验一致', p3.totalAllocated === 2 && p3.totalAllocated === p3plain.totalAllocated);
check('两个出口均足额、总缺口 0', p3.totalShortfall === 0 && p3.rows.every((x) => x.fullySupplied));

console.log('优先配水：重点本身无法足额时：');
const p4net = {
  nodes: ['S', 'P', 'X'],
  pipes: [],
  valvedPipes: [{ id: 'V1', from: 'S', to: 'P', open: true }],
};
const p4 = solver.verifyPriorityCapacity(p4net, {
  supplies: ['S'], outlets: ['P', 'X'], priorityOutlets: ['P'],
  supplyCaps: { S: 9 }, outletDemands: { P: 5, X: 2 },
});
check('重点经单管最多获配 1', p4.status === 'ok' && p4.priorityAllocated === 1 && p4.priorityShortfall === 4);
check('总获配同为 1（X 不通为 0）', p4.totalAllocated === 1 && prioRow(p4, 'X').allocated === 0);

console.log('优先配水：与普通核验总获配一致（多网络对照）：');
for (const [net, q] of [
  [bigNet, { supplies: ['SA', 'SB'], outlets: ['O'], priorityOutlets: ['O'], supplyCaps: { SA: 2, SB: 1 }, outletDemands: { O: 100 } }],
  [c3net, { supplies: ['SA', 'SB'], outlets: ['OA', 'OB', 'OC'], priorityOutlets: ['OA'], supplyCaps: { SA: 5, SB: 5 }, outletDemands: { OA: 1, OB: 1, OC: 1 } }],
  [cutCapNet, { supplies: ['S'], outlets: ['O'], priorityOutlets: ['O'], supplyCaps: { S: 5 }, outletDemands: { O: 3 } }],
  [sharedNet, { supplies: ['S1', 'S2'], outlets: ['O'], priorityOutlets: ['O'], supplyCaps: { S1: 5, S2: 5 }, outletDemands: { O: 5 } }],
]) {
  const plain = solver.verifyCapacity(net, q);
  const pri = solver.verifyPriorityCapacity(net, q);
  check(`重点场景总获配 ${pri.totalAllocated} 等于普通核验 ${plain.totalAllocated}`,
    pri.status === 'ok' && pri.totalAllocated === plain.totalAllocated);
}

console.log('优先配水：校验与纯函数：');
const pe1 = prio(['S1'], ['B'], ['NOPE'], { S1: 1 }, { B: 1 });
check('重点出口不在名单中报错', pe1.status === 'invalid' && pe1.errors.some((e) => e.includes('不在保供出口名单')));
const pe2 = solver.verifyPriorityCapacity(network, {
  supplies: ['S1'], outlets: ['B'], priorityOutlets: 'B',
  supplyCaps: { S1: 1 }, outletDemands: { B: 1 },
});
check('重点名单不是数组时报错', pe2.status === 'invalid');
const pe3 = prio(['NOPE'], ['B'], ['B'], { NOPE: 1 }, { B: 1 });
check('沿用核验校验：供水点不存在时报错', pe3.status === 'invalid');
const pe4 = prio(['S1'], ['B'], ['B'], { S1: -1 }, { B: 1 });
check('沿用核验校验：负整数上限被拒绝', pe4.status === 'invalid');
const pe5 = solver.verifyCapacity(network, {
  supplies: ['S1', 'S2'], outlets: ['B'], priorityOutlets: ['B'],
  supplyCaps: { S1: 2, S2: 2 }, outletDemands: { B: 3 },
});
check('普通核验忽略重点字段，结果不受影响', pe5.status === 'ok' && pe5.totalAllocated === 1);
const beforePrio = JSON.stringify(network);
prio(['S1', 'S2'], ['B', 'C', 'D'], ['B', 'C'], { S1: 5, S2: 3 }, { B: 2, C: 1, D: 1 });
check('优先配水不修改输入网络与数值', JSON.stringify(network) === beforePrio);
// 重点名单重复时按去重处理，不报错
const pe6 = prio(['S1'], ['B'], ['B', 'B'], { S1: 1 }, { B: 1 });
check('重复重点出口去重处理', pe6.status === 'ok' && pe6.priorityOutletCount === 1);

// ============ 管段增容建议 ============
console.log('管段增容建议：');

const exp = (net, supplies, outlets, supplyCaps, outletDemands) =>
  solver.suggestExpansion(net, { supplies, outlets, supplyCaps, outletDemands });

// 与核验同一网络与数值：基线受 V01/V02 入环限制为 2；
// 单条 V01（或 V02）提容即可到 3，字典序最小为 [V01]
const e1 = exp(network, ['S1', 'S2'], ['B', 'C', 'D'], { S1: 5, S2: 3 }, { B: 2, C: 1, D: 1 });
check('增容返回 ok', e1.status === 'ok');
check('基线总获配与核验一致（2）', e1.baseline === 2);
check('推荐单条改造 V01（同增量下条数最少、字典序最小）', e1.recommended.upgraded.join(',') === 'V01');
check('推荐总获配 3、增量 1', e1.recommended.totalAllocated === 3 && e1.recommended.gain === 1);
check('单条最优即推荐方案', e1.bestSingle.upgraded.join(',') === 'V01' && e1.bestSingle.totalAllocated === 3);
check('两条最优同样为 3（字典序最小对 [P1,V01]）',
  e1.bestPair.totalAllocated === 3 && e1.bestPair.upgraded.join(',') === 'P1,V01');
check('候选管段数（2 无阀 + 8 开启，排除已关 V09）', e1.activePipeCount === 10);
check('已关阀 V09 不出现在任何方案中',
  !e1.recommended.upgraded.includes('V09') && !e1.bestSingle.upgraded.includes('V09') &&
  !e1.bestPair.upgraded.includes('V09'));

console.log('增容：两条一起改造才产生收益（串联瓶颈）：');
// S—V1—M—V2—O 串联：单条提容仍受另一条限制，两条一起才通
const seriesNet = {
  nodes: ['S', 'M', 'O'],
  pipes: [],
  valvedPipes: [
    { id: 'V1', from: 'S', to: 'M', open: true },
    { id: 'V2', from: 'M', to: 'O', open: true },
  ],
};
const e2 = exp(seriesNet, ['S'], ['O'], { S: 5 }, { O: 5 });
check('串联基线为 1', e2.baseline === 1);
check('单条改造无收益', e2.bestSingle.totalAllocated === 1 && e2.bestSingle.gain === 0);
check('两条一起改造提升至 2', e2.bestPair.totalAllocated === 2 && e2.bestPair.gain === 1);
check('推荐两条组合 [V1,V2]', e2.recommended.upgraded.join(',') === 'V1,V2' &&
  e2.recommended.totalAllocated === 2 && e2.recommended.gain === 1);

console.log('增容：零增量时推荐不改造：');
// 供给上限 1 卡住总获配，管段提容无收益
const noGainNet = {
  nodes: ['S', 'O'],
  pipes: [],
  valvedPipes: [{ id: 'V1', from: 'S', to: 'O', open: true }],
};
const e3 = exp(noGainNet, ['S'], ['O'], { S: 1 }, { O: 5 });
check('受供给上限 1 限制，基线 1', e3.baseline === 1);
check('推荐不改造（空清单、增量 0）',
  e3.recommended.upgraded.length === 0 && e3.recommended.gain === 0 && e3.recommended.totalAllocated === 1);
check('单条最优同样无收益', e3.bestSingle.totalAllocated === 1 && e3.bestSingle.gain === 0);
check('仅一条候选时无两条组合', e3.bestPair === null);

console.log('增容：已关阀与自环不可选：');
const skipNet = {
  nodes: ['S', 'O'],
  pipes: [{ id: 'P0', from: 'S', to: 'S' }], // 自环
  valvedPipes: [
    { id: 'V1', from: 'S', to: 'O', open: true },
    { id: 'V9', from: 'S', to: 'O', open: false }, // 已关阀
  ],
};
const e4 = exp(skipNet, ['S'], ['O'], { S: 5 }, { O: 5 });
check('候选仅 1 条（自环与已关阀不计）', e4.activePipeCount === 1);
check('推荐改造 V1 提容至 2', e4.recommended.upgraded.join(',') === 'V1' && e4.recommended.totalAllocated === 2);
check('无两条组合可选', e4.bestPair === null);

console.log('增容：两条组合按编号列表字典序取舍：');
// 两条并联支路 S—V1—A—V2—O 与 S—V3—B—V4—O，改造任一支路的两条管均可 +1
const twoPairNet = {
  nodes: ['S', 'A', 'B', 'O'],
  pipes: [],
  valvedPipes: [
    { id: 'V1', from: 'S', to: 'A', open: true },
    { id: 'V2', from: 'A', to: 'O', open: true },
    { id: 'V3', from: 'S', to: 'B', open: true },
    { id: 'V4', from: 'B', to: 'O', open: true },
  ],
};
const e5 = exp(twoPairNet, ['S'], ['O'], { S: 9 }, { O: 9 });
check('双支路基线 2', e5.baseline === 2);
check('单条改造无收益（支路串联）', e5.bestSingle.totalAllocated === 2);
check('推荐字典序最小对 [V1,V2] → 3',
  e5.recommended.upgraded.join(',') === 'V1,V2' && e5.recommended.totalAllocated === 3 && e5.recommended.gain === 1);

console.log('增容：纯函数与输入校验：');
const beforeExp = JSON.stringify(network);
exp(network, ['S1', 'S2'], ['B'], { S1: 2, S2: 2 }, { B: 3 });
check('增容不修改输入网络', JSON.stringify(network) === beforeExp);
const ee1 = exp(network, ['S1'], ['B'], { S1: -1 }, { B: 1 });
check('负整数上限被拒绝', ee1.status === 'invalid' && ee1.errors.some((e) => e.includes('非负整数')));
const ee2 = exp(network, ['S1'], ['B'], {}, { B: 1 });
check('缺少上限被拒绝', ee2.status === 'invalid');
const ee3 = exp(network, [], ['B'], {}, { B: 1 });
check('缺少供水点被拒绝', ee3.status === 'invalid');
const ee4 = exp(network, ['NOPE'], ['B'], { NOPE: 1 }, { B: 1 });
check('供水点不存在时报错', ee4.status === 'invalid');

// ============ 阀门状态异常定位 ============
console.log('阀门状态异常定位：');

// 登记状态下全部节点均可达 S1/S2（V09 虽关，B 仍经 V08 连通）：
// 观测 B、C 有水与登记一致 → 零翻转
const a0 = solver.locateValveAnomalies(network, { supplies: ['S1', 'S2'], wetNodes: ['B', 'C'], dryNodes: [] });
check('零翻转：登记状态与观测一致', a0.status === 'ok' && a0.minFlips === 0 &&
  a0.solutions.length === 1 && a0.solutions[0].flipped.length === 0);
check('零翻转方案的翻转后状态与登记一致', a0.solutions[0].valveStates.every(
  (v) => v.actualOpen === v.registeredOpen && !v.flipped
));

// B 现场无水：登记中 B 仅经 V08（V09 已关）连网，唯一单翻转解释为 V08 实际已关
const a1 = solver.locateValveAnomalies(network, { supplies: ['S1', 'S2'], wetNodes: ['C', 'D'], dryNodes: ['B'] });
check('单翻转唯一定位 V08', a1.status === 'ok' && a1.minFlips === 1 &&
  a1.solutions.length === 1 && a1.solutions[0].flipped.join(',') === 'V08');
const v08row = a1.solutions[0].valveStates.find((v) => v.id === 'V08');
check('翻转后 V08 实际为关且标记已翻转', v08row.registeredOpen === true && v08row.actualOpen === false && v08row.flipped === true);
const v09row = a1.solutions[0].valveStates.find((v) => v.id === 'V09');
check('V09 保持登记关闭且未翻转', v09row.registeredOpen === false && v09row.actualOpen === false && !v09row.flipped);
check('翻转后状态表按阀门编号升序', a1.solutions[0].valveStates.map((v) => v.id).join(',') ===
  network.valvedPipes.map((v) => v.id).sort().join(','));

console.log('异常定位：已关阀可被翻转为开：');
// O 仅经已关阀 V2 挂网，现场观测 O 有水 → 必须翻转 V2（关→开）
const closedOnlyNet = {
  nodes: ['S', 'X', 'O'],
  pipes: [],
  valvedPipes: [
    { id: 'V1', from: 'S', to: 'X', open: true },
    { id: 'V2', from: 'X', to: 'O', open: false },
  ],
};
const a2 = solver.locateValveAnomalies(closedOnlyNet, { supplies: ['S'], wetNodes: ['O'], dryNodes: [] });
check('翻转已关阀 V2 解释观测', a2.status === 'ok' && a2.minFlips === 1 &&
  a2.solutions.length === 1 && a2.solutions[0].flipped.join(',') === 'V2');
check('翻转后 V2 实际为开', a2.solutions[0].valveStates.find((v) => v.id === 'V2').actualOpen === true);

console.log('异常定位：两处翻转才能解释：');
// 菱形 S—V1—A，A—V2—B，A—V3—O，B—V4—O：观测 O 有水、B 无水，
// 须同时切断 B 的两条连接 V2、V4（单翻任意一条 B 仍经另一条连通）
const twoFlipNet = {
  nodes: ['S', 'A', 'B', 'O'],
  pipes: [],
  valvedPipes: [
    { id: 'V1', from: 'S', to: 'A', open: true },
    { id: 'V2', from: 'A', to: 'B', open: true },
    { id: 'V3', from: 'A', to: 'O', open: true },
    { id: 'V4', from: 'B', to: 'O', open: true },
  ],
};
const a3 = solver.locateValveAnomalies(twoFlipNet, { supplies: ['S'], wetNodes: ['O'], dryNodes: ['B'] });
check('两处翻转唯一方案 [V2,V4]', a3.status === 'ok' && a3.minFlips === 2 &&
  a3.solutions.length === 1 && a3.solutions[0].flipped.join(',') === 'V2,V4');

console.log('异常定位：同数翻转列出全部方案且按字典序：');
// 链 S—V1—M—V2—O，仅观测 O 无水：翻 V1 或 V2 均可解释
const chainNet = {
  nodes: ['S', 'M', 'O'],
  pipes: [],
  valvedPipes: [
    { id: 'V1', from: 'S', to: 'M', open: true },
    { id: 'V2', from: 'M', to: 'O', open: true },
  ],
};
const a5 = solver.locateValveAnomalies(chainNet, { supplies: ['S'], wetNodes: [], dryNodes: ['O'] });
check('两个等价单翻转方案均列出', a5.status === 'ok' && a5.minFlips === 1 && a5.solutions.length === 2);
check('方案按阀门编号字典序排列', a5.solutions[0].flipped[0] === 'V1' && a5.solutions[1].flipped[0] === 'V2');

console.log('异常定位：无匹配与未观测节点不参与判定：');
// O 经无阀管段 P1 与 S 直连，观测 O 无水：任何阀门翻转都无法解释
const noMatchNet = {
  nodes: ['S', 'O'],
  pipes: [{ id: 'P1', from: 'S', to: 'O' }],
  valvedPipes: [{ id: 'V1', from: 'S', to: 'O', open: true }],
};
const a4 = solver.locateValveAnomalies(noMatchNet, { supplies: ['S'], wetNodes: [], dryNodes: ['O'] });
check('两处以内无法解释时返回 no-match', a4.status === 'no-match' && a4.valveCount === 1);
// 未观测节点不参与：观测点仅为 B（无水），其余节点状态不影响判定
const a6 = solver.locateValveAnomalies(network, { supplies: ['S1', 'S2'], wetNodes: [], dryNodes: ['B'] });
check('只用已观测节点判定（仅 B 无水仍定位 V08）', a6.status === 'ok' && a6.minFlips === 1 &&
  a6.solutions.length === 1 && a6.solutions[0].flipped.join(',') === 'V08');

console.log('异常定位：校验与纯函数：');
const ae1 = solver.locateValveAnomalies(network, { supplies: ['NOPE'], wetNodes: ['B'], dryNodes: [] });
check('供水点不存在时报错', ae1.status === 'invalid');
const ae2 = solver.locateValveAnomalies(network, { supplies: ['S1'], wetNodes: ['NOPE'], dryNodes: [] });
check('有水观测节点不存在时报错', ae2.status === 'invalid');
const ae3 = solver.locateValveAnomalies(network, { supplies: ['S1'], wetNodes: [], dryNodes: ['NOPE'] });
check('无水观测节点不存在时报错', ae3.status === 'invalid');
const ae4 = solver.locateValveAnomalies(network, { supplies: ['S1'], wetNodes: ['B'], dryNodes: ['B'] });
check('同一节点同时有水无水判定冲突', ae4.status === 'invalid' && ae4.errors.some((e) => e.includes('冲突')));
const ae5 = solver.locateValveAnomalies(network, { supplies: [], wetNodes: ['B'], dryNodes: [] });
check('缺少供水点时报错', ae5.status === 'invalid');
const ae6 = solver.locateValveAnomalies(network, { supplies: ['S1'], wetNodes: [], dryNodes: [] });
check('没有任何观测节点时报错', ae6.status === 'invalid');
const ae7 = solver.locateValveAnomalies(network, { supplies: ['S1'], wetNodes: [], dryNodes: ['S1'] });
check('供水点登记为无水判定冲突', ae7.status === 'invalid' && ae7.errors.some((e) => e.includes('恒有水')));
const ae8 = solver.locateValveAnomalies(network, { supplies: ['S1'], wetNodes: ['B', 'B'], dryNodes: ['C', 'C'] });
check('重复观测节点去重后不报错', ae8.status === 'ok');
const beforeAnom = JSON.stringify(network);
solver.locateValveAnomalies(network, { supplies: ['S1', 'S2'], wetNodes: ['C'], dryNodes: ['B'] });
check('异常定位不修改输入网络', JSON.stringify(network) === beforeAnom);

// ============ 单阀异常观测点规划 ============
console.log('单阀异常观测点规划：');

// 登记状态下（测试主网络）：单翻 V08 → B 无水；单翻 V07 → D 无水；其余单翻不改变
// B/D 的有水状态（V01/V02/V09 等不在其唯一通路上）。
// 候选 [A,B,C,D]：
//   组1（baseline + V01..V06,V09）签名 [1,1,1,1]
//   组2（V07）                       [1,1,1,0]
//   组3（V08）                       [1,0,1,1]
const o1 = solver.planSingleValveObservers(network, { supplies: ['S1', 'S2'], candidates: ['A', 'B', 'C', 'D'] });
check('规划返回 ok', o1.status === 'ok');
check('假设总数 = 阀门数 9 + 1', o1.hypothesisCount === 10 && o1.valveCount === 9);
check('候选节点按名称升序', o1.candidates.join(',') === 'A,B,C,D');
check('归为 3 个不可区分组', o1.groups.length === 3);
check('可区分且最少观测点数为 2', o1.distinguishable === true && o1.pointCount === 2);
check('推荐观测点 [B,D]（按节点名称升序列表）', o1.recommendedPoints.join(',') === 'B,D');
const og1 = o1.groups[0];
check('第 1 组含登记状态（排在首位）', og1.hypotheses[0].kind === 'baseline' && og1.hypotheses.length === 8);
check('第 1 组含 V01、V09（环路单翻不改变签名）',
  og1.hypotheses.some((h) => h.flippedValve === 'V01') && og1.hypotheses.some((h) => h.flippedValve === 'V09'));
check('第 2 组仅 V07（D 无水）', o1.groups[1].hypotheses.length === 1 && o1.groups[1].hypotheses[0].flippedValve === 'V07');
check('第 3 组仅 V08（B 无水）', o1.groups[2].hypotheses.length === 1 && o1.groups[2].hypotheses[0].flippedValve === 'V08');
// 各组在推荐点 [B,D] 上的预期状态
check('组1 在推荐点预期 有水/有水', o1.groups[0].expectedStates.join(',') === 'true,true');
check('组2 在推荐点预期 有水/无水', o1.groups[1].expectedStates.join(',') === 'true,false');
check('组3 在推荐点预期 无水/有水', o1.groups[2].expectedStates.join(',') === 'false,true');
// 完整签名
check('组2 完整签名 [A有水,B有水,C有水,D无水]', o1.groups[1].signature.join(',') === 'true,true,true,false');
check('组3 完整签名 [A有水,B无水,C有水,D有水]', o1.groups[2].signature.join(',') === 'true,false,true,true');

console.log('观测点规划：单点即可区分（且剔除恒湿的冗余候选）：');
// S—V1—M，M 经并行的 V2/V3 接 O；候选 [O, S]（S 是供水点，恒有水、无区分力）。
// baseline / 翻 V2 / 翻 V3：O 有水；翻 V1：O 无水 → 2 组；单点 O 即可区分
const obsRedundantNet = {
  nodes: ['S', 'M', 'O'],
  pipes: [],
  valvedPipes: [
    { id: 'V1', from: 'S', to: 'M', open: true },
    { id: 'V2', from: 'M', to: 'O', open: true },
    { id: 'V3', from: 'M', to: 'O', open: true },
  ],
};
const o2 = solver.planSingleValveObservers(obsRedundantNet, { supplies: ['S'], candidates: ['O', 'S'] });
check('4 个假设归为 2 组', o2.status === 'ok' && o2.groups.length === 2 && o2.hypothesisCount === 4);
check('恒湿的供水点 S 不入推荐，单点 O 即可区分', o2.pointCount === 1 && o2.recommendedPoints.join(',') === 'O');
check('大组含 baseline、V2、V3（并行阀单翻不影响 O）',
  o2.groups[0].hypotheses.length === 3 &&
  o2.groups[0].hypotheses.some((h) => h.kind === 'baseline') &&
  o2.groups[0].hypotheses.some((h) => h.flippedValve === 'V2'));
check('小组仅 V1（O 无水）', o2.groups[1].hypotheses.length === 1 &&
  o2.groups[1].hypotheses[0].flippedValve === 'V1');

console.log('观测点规划：同数按节点名称升序列表字典序：');
// S—V1—M—V2—N，X、Y 经无阀管段并接在 N 后：
// 翻 V1 或 V2 都使 X、Y 同时无水（同组），baseline 两点均有水；
// X 与 Y 单点均可区分两组，同数时字典序推荐 [X]
const tieObsNet = {
  nodes: ['S', 'M', 'N', 'X', 'Y'],
  pipes: [
    { id: 'P1', from: 'N', to: 'X' },
    { id: 'P2', from: 'N', to: 'Y' },
  ],
  valvedPipes: [
    { id: 'V1', from: 'S', to: 'M', open: true },
    { id: 'V2', from: 'M', to: 'N', open: true },
  ],
};
const o3 = solver.planSingleValveObservers(tieObsNet, { supplies: ['S'], candidates: ['X', 'Y'] });
check('baseline 一组、V1/V2 同组（共 2 组）', o3.groups.length === 2 &&
  o3.groups[0].hypotheses.length === 1 && o3.groups[1].hypotheses.length === 2);
check('同数单点取名称升序 [X]', o3.pointCount === 1 && o3.recommendedPoints.join(',') === 'X');
check('两组在 X 点预期 有水 / 无水', o3.groups[0].expectedStates[0] === true &&
  o3.groups[1].expectedStates[0] === false);

console.log('观测点规划：全部假设同组时无法区分：');
// 两个仅经阀门的串联分支在任何单阀翻转下候选点状态一致：
// 环网 S—V1—A—V2—S 与挂点 O 经 V3 接 A；只选 A 为候选时 baseline/V1/V2 均有水（V3 不翻），
// 翻转 V3 使 A 仍有水——故需要构造：候选节点恒有水（供水点）→ 所有签名相同
const sameObsNet = {
  nodes: ['S', 'O'],
  pipes: [],
  valvedPipes: [{ id: 'V1', from: 'S', to: 'O', open: true }],
};
const o4 = solver.planSingleValveObservers(sameObsNet, { supplies: ['S'], candidates: ['S'] });
check('全部假设同组：标记不可区分', o4.status === 'ok' && o4.distinguishable === false && o4.groups.length === 1);
check('不可区分时无推荐点', o4.recommendedPoints === null && o4.pointCount === 0);
check('同组包含登记状态与 V1 两个假设', o4.groups[0].hypotheses.length === 2);

console.log('观测点规划：已关阀单独翻转为开也作为假设：');
// S—V1(开)—X—V2(关)—O：baseline 时 X 有水、O 无水；翻 V2 后 O 有水
const closedObsNet = {
  nodes: ['S', 'X', 'O'],
  pipes: [],
  valvedPipes: [
    { id: 'V1', from: 'S', to: 'X', open: true },
    { id: 'V2', from: 'X', to: 'O', open: false },
  ],
};
const o5 = solver.planSingleValveObservers(closedObsNet, { supplies: ['S'], candidates: ['O'] });
check('baseline 与翻 V1 同组（O 均无水），翻 V2 另成一组', o5.groups.length === 2);
const o5flipV2 = o5.groups.find((g) => g.hypotheses.some((h) => h.flippedValve === 'V2'));
check('翻 V2 假设记录 关→开', o5flipV2.hypotheses[0].registeredOpen === false &&
  o5flipV2.hypotheses[0].actualOpen === true);
check('翻 V2 组在 O 点预期有水', o5flipV2.signature[0] === true);

console.log('观测点规划：无阀管段直连时阀门翻转不影响签名：');
const pipeObsNet = {
  nodes: ['S', 'O'],
  pipes: [{ id: 'P1', from: 'S', to: 'O' }],
  valvedPipes: [{ id: 'V1', from: 'S', to: 'O', open: true }],
};
const o6 = solver.planSingleValveObservers(pipeObsNet, { supplies: ['S'], candidates: ['O'] });
check('无阀管直连：各假设在 O 点恒有水，全部同组', o6.status === 'ok' &&
  o6.distinguishable === false && o6.groups[0].signature[0] === true);

console.log('观测点规划：校验与纯函数：');
const oe1 = solver.planSingleValveObservers(network, { supplies: ['NOPE'], candidates: ['B'] });
check('供水点不存在时报错', oe1.status === 'invalid');
const oe2 = solver.planSingleValveObservers(network, { supplies: ['S1'], candidates: ['NOPE'] });
check('候选节点不存在时报错', oe2.status === 'invalid');
const oe3 = solver.planSingleValveObservers(network, { supplies: ['S1'], candidates: [] });
check('候选节点为空时报错', oe3.status === 'invalid');
const oe4 = solver.planSingleValveObservers(network, { supplies: [], candidates: ['B'] });
check('缺少供水点时报错', oe4.status === 'invalid');
const manyNodeNet = {
  nodes: Array.from({ length: 13 }, (_, i) => `n${i}`),
  pipes: [],
  valvedPipes: [{ id: 'V1', from: 'n0', to: 'n1', open: true }],
};
const oe5 = solver.planSingleValveObservers(manyNodeNet, {
  supplies: ['n0'],
  candidates: manyNodeNet.nodes,
});
check('候选超过 12 个时报错（节点均存在）', oe5.status === 'invalid' && oe5.errors.some((e) => e.includes('12')));
const o7 = solver.planSingleValveObservers(network, { supplies: ['S1', 'S2'], candidates: ['B', 'B', 'C'] });
check('候选节点重复时去重不报错', o7.status === 'ok' && o7.candidates.join(',') === 'B,C');
const beforeObs = JSON.stringify(network);
solver.planSingleValveObservers(network, { supplies: ['S1', 'S2'], candidates: ['A', 'B', 'C', 'D'] });
check('观测点规划不修改输入网络', JSON.stringify(network) === beforeObs);
// 无阀网络（零阀门）：只有登记状态一个假设，天然同组
const noValveNet = { nodes: ['S', 'O'], pipes: [{ id: 'P1', from: 'S', to: 'O' }], valvedPipes: [] };
const o8 = solver.planSingleValveObservers(noValveNet, { supplies: ['S'], candidates: ['O'] });
check('无阀门时仅 1 个假设且标记不可区分', o8.status === 'ok' &&
  o8.hypothesisCount === 1 && o8.distinguishable === false);

// ============ 双阀意外关闭风险扫描 ============
console.log('双阀意外关闭风险扫描：');

const risk = (net, supplies, outlets, supplyCaps, outletDemands) =>
  solver.scanValveClosureRisk(net, { supplies, outlets, supplyCaps, outletDemands });
const riskRow = (r, ...ids) =>
  r.lossScenarios.find((s) => s.closedValves.join(',') === ids.join(','));

// 测试主网络：基线受 V01/V02 入环限制为 2（与供水能力核验一致）
const rk1 = risk(network, ['S1', 'S2'], ['B', 'C', 'D'], { S1: 5, S2: 3 }, { B: 2, C: 1, D: 1 });
check('扫描返回 ok', rk1.status === 'ok');
check('基线总获配与核验一致（2）', rk1.baselineAllocated === 2);
check('开启阀门 8 个（已关 V09 不参与）', rk1.openValveCount === 8);
check('场景总数 = 8 单阀 + 28 两阀', rk1.scenarioCount === 36);
check('参与输水管段 10 条（2 无阀 + 8 开启）', rk1.activePipeCount === 10);
// 有损场景：单阀 V01/V02（各 1）；两阀 [V01,V02] 缺口 2；
// 其余缺口 1：V01/V02 各与 V03..V08 组合（12 对）+ 协同 7 对（共 22 个）
check('全部有损场景均列出（2 单阀 + 20 两阀 = 22）', rk1.lossScenarios.length === 22);
// 单阀：关 V01 / V02 各使入环能力 -1
const rkV01 = riskRow(rk1, 'V01');
check('单关 V01：获配 1、新增缺口 1', rkV01.kind === 'single' &&
  rkV01.totalAllocated === 1 && rkV01.addedShortfall === 1 && rkV01.synergistic === false);
check('单关 V02：获配 1、新增缺口 1', riskRow(rk1, 'V02').addedShortfall === 1);
check('单关 V03 / V05 无新增缺口（不入清单）',
  riskRow(rk1, 'V03') === undefined && riskRow(rk1, 'V05') === undefined);
// 两阀同时关 V01、V02：入环能力归零
const rkPair12 = riskRow(rk1, 'V01', 'V02');
check('两阀 [V01,V02]：获配 0、新增缺口 2', rkPair12.kind === 'pair' &&
  rkPair12.totalAllocated === 0 && rkPair12.addedShortfall === 2);
check('两阀 [V01,V02] 非协同（2 不大于 1+1）', rkPair12.synergistic === false);
// 含单阀损失的两阀对：缺口 1 但单阀之和已为 1，不标协同
check('[V01,V05] 缺口 1 但非协同（1 不大于 1+0）',
  riskRow(rk1, 'V01', 'V05').addedShortfall === 1 &&
  riskRow(rk1, 'V01', 'V05').synergistic === false);
// 协同失供：两阀单关均无损，同关才切断独立路径
const rkPair35 = riskRow(rk1, 'V03', 'V05');
check('两阀 [V03,V05]：获配 1、新增缺口 1', rkPair35.totalAllocated === 1 && rkPair35.addedShortfall === 1);
check('两阀 [V03,V05] 标为协同失供（1 > 0+0）', rkPair35.synergistic === true);
check('其余协同对 [V03,V08]、[V04,V05]、[V04,V08]、[V05,V06]、[V05,V08]、[V07,V08] 均标出',
  ['V03,V08', 'V04,V05', 'V04,V08', 'V05,V06', 'V05,V08', 'V07,V08']
    .every((k) => riskRow(rk1, ...k.split(',')).synergistic === true));
check('非协同对 [V03,V06]、[V04,V06] 无损（不入清单）',
  riskRow(rk1, 'V03', 'V06') === undefined && riskRow(rk1, 'V04', 'V06') === undefined);
// 排序：新增缺口降序；同缺口按阀门编号列表字典序（短列表为长列表前缀时短者在前）
check('有损场景按缺口降序 + 编号列表字典序排列',
  rk1.lossScenarios.map((s) => s.closedValves.join('+')).join('|') === [
    'V01+V02',
    'V01', 'V01+V03', 'V01+V04', 'V01+V05', 'V01+V06', 'V01+V07', 'V01+V08',
    'V02', 'V02+V03', 'V02+V04', 'V02+V05', 'V02+V06', 'V02+V07', 'V02+V08',
    'V03+V05', 'V03+V08', 'V04+V05', 'V04+V08', 'V05+V06', 'V05+V08', 'V07+V08',
  ].join('|'));

console.log('风险扫描：无有损场景时明确提示（空清单）：');
// 供水点经 8 条并行管接出口：任意两阀同关仍留有 6 条通道，供给上限 2 为瓶颈
const noLossNet = {
  nodes: ['S', 'O'],
  pipes: [],
  valvedPipes: Array.from({ length: 8 }, (_, i) => ({ id: `V${i}`, from: 'S', to: 'O', open: true })),
};
const rk2 = risk(noLossNet, ['S'], ['O'], { S: 2 }, { O: 9 });
check('返回 ok 且基线 2', rk2.status === 'ok' && rk2.baselineAllocated === 2);
check('36 个场景全部无损（空清单）', rk2.scenarioCount === 36 && rk2.lossScenarios.length === 0);

console.log('风险扫描：零开启阀门与上限校验：');
const noOpenNet = {
  nodes: ['S', 'O'],
  pipes: [{ id: 'P1', from: 'S', to: 'O' }],
  valvedPipes: [{ id: 'V1', from: 'S', to: 'O', open: false }],
};
const rk3 = risk(noOpenNet, ['S'], ['O'], { S: 5 }, { O: 5 });
check('零开启阀门：0 场景、空清单', rk3.status === 'ok' &&
  rk3.openValveCount === 0 && rk3.scenarioCount === 0 && rk3.lossScenarios.length === 0);
const overNet = {
  nodes: ['a', 'b'],
  pipes: [],
  valvedPipes: Array.from({ length: 21 }, (_, i) => ({ id: `V${i}`, from: 'a', to: 'b', open: true })),
};
const rk4 = risk(overNet, ['a'], ['b'], { a: 1 }, { b: 1 });
check('超过 20 个开启阀门被拒绝', rk4.status === 'invalid' && rk4.errors.some((e) => e.includes('21')));
const exactNet = {
  nodes: ['a', 'b'],
  pipes: [],
  valvedPipes: Array.from({ length: 20 }, (_, i) => ({ id: `V${i}`, from: 'a', to: 'b', open: true })),
};
const rk5 = risk(exactNet, ['a'], ['b'], { a: 3 }, { b: 9 });
check('恰好 20 个开启阀门可扫描（210 场景）', rk5.status === 'ok' && rk5.scenarioCount === 210);

console.log('风险扫描：校验与纯函数：');
const rk6 = risk(network, ['S1'], ['B'], { S1: -1 }, { B: 1 });
check('负整数上限被拒绝', rk6.status === 'invalid' && rk6.errors.some((e) => e.includes('非负整数')));
const rk7 = risk(network, ['NOPE'], ['B'], { NOPE: 1 }, { B: 1 });
check('供水点不存在时报错', rk7.status === 'invalid');
const beforeRisk = JSON.stringify(network);
solver.scanValveClosureRisk(network, { supplies: ['S1', 'S2'], outlets: ['B', 'C', 'D'], supplyCaps: { S1: 5, S2: 3 }, outletDemands: { B: 2, C: 1, D: 1 } });
check('扫描不修改输入网络与登记状态', JSON.stringify(network) === beforeRisk);

// ============ 复水开阀顺序规划 ============
console.log('复水开阀顺序规划：');

const reopen = (net, supplies, outlets, supplyCaps, outletDemands) =>
  solver.planReopenSequence(net, { supplies, outlets, supplyCaps, outletDemands });

// 测试主网络：唯一已关阀 V09；基线受 V01/V02 入环限制为 2，
// 开启 V09 后 B 多一条并行管，但总获配仍受入环能力限制为 2
const ro1 = reopen(network, ['S1', 'S2'], ['B', 'C', 'D'], { S1: 5, S2: 3 }, { B: 2, C: 1, D: 1 });
check('规划返回 ok', ro1.status === 'ok');
check('待开阀门 1 个（V09）', ro1.closedValveCount === 1);
check('基线总获配与核验一致（2）', ro1.baselineAllocated === 2);
check('基线参与输水管段 10 条（2 无阀 + 8 开启）', ro1.activePipeCount === 10);
check('最终顺序即 [V09]', ro1.finalOrder.join(',') === 'V09');
check('开 V09 后总获配仍为 2（入环瓶颈）', ro1.finalAllocated === 2);
check('步骤明细：第 1 步开 V09、总获配 2、累计 2',
  ro1.steps.length === 1 && ro1.steps[0].step === 1 && ro1.steps[0].valve === 'V09' &&
  ro1.steps[0].totalAllocated === 2 && ro1.steps[0].cumulativeAllocated === 2);
check('目标值（各步总获配之和）为 2', ro1.objective === 2);

console.log('复水规划：顺序敏感——先开有即时收益的阀门：');
// V2、V3 串联（单独开任一均无收益，全开才通），V4 直通（开了立即 +1）。
// 最优顺序须先开 V4；[V4,V2,V3] 与 [V4,V3,V2] 同分，字典序取 [V4,V2,V3]。
const reopenNet = {
  nodes: ['S', 'M', 'X', 'O'],
  pipes: [],
  valvedPipes: [
    { id: 'V1', from: 'S', to: 'M', open: true },
    { id: 'V2', from: 'M', to: 'X', open: false },
    { id: 'V3', from: 'X', to: 'O', open: false },
    { id: 'V4', from: 'S', to: 'O', open: false },
  ],
};
const ro2 = reopen(reopenNet, ['S'], ['O'], { S: 5 }, { O: 5 });
check('返回 ok 且待开 3 个', ro2.status === 'ok' && ro2.closedValveCount === 3);
check('基线总获配 0（O 不通）', ro2.baselineAllocated === 0);
check('最终顺序 [V4,V2,V3]（先开直通阀，同分字典序最小）', ro2.finalOrder.join(',') === 'V4,V2,V3');
check('各步总获配 1,1,2', ro2.steps.map((s) => s.totalAllocated).join(',') === '1,1,2');
check('累计获配 1,2,4', ro2.steps.map((s) => s.cumulativeAllocated).join(',') === '1,2,4');
check('目标值 4 = 最后一步累计获配', ro2.objective === 4 && ro2.steps[2].cumulativeAllocated === 4);
check('全部开完后总获配 2', ro2.finalAllocated === 2);

console.log('复水规划：空清单提示无需复水：');
const allOpenNet = {
  nodes: ['S', 'O'],
  pipes: [],
  valvedPipes: [{ id: 'V1', from: 'S', to: 'O', open: true }],
};
const ro3 = reopen(allOpenNet, ['S'], ['O'], { S: 5 }, { O: 5 });
check('全部阀门开启时返回 empty', ro3.status === 'empty' && ro3.reason.includes('无需复水'));
const noValveNet2 = { nodes: ['S', 'O'], pipes: [{ id: 'P1', from: 'S', to: 'O' }], valvedPipes: [] };
check('无阀门网络同样返回 empty', reopen(noValveNet2, ['S'], ['O'], { S: 1 }, { O: 1 }).status === 'empty');

console.log('复水规划：待开阀门数量上限：');
const nineClosedNet = {
  nodes: ['a', 'b'],
  pipes: [],
  valvedPipes: Array.from({ length: 9 }, (_, i) => ({ id: `V${i}`, from: 'a', to: 'b', open: false })),
};
const ro4 = reopen(nineClosedNet, ['a'], ['b'], { a: 9 }, { b: 9 });
check('9 个待开阀门被拒绝（无法规划）', ro4.status === 'too-many' && ro4.closedValveCount === 9 &&
  ro4.reason.includes('9') && ro4.reason.includes('8'));
const eightClosedNet = {
  nodes: ['a', 'b'],
  pipes: [],
  valvedPipes: Array.from({ length: 8 }, (_, i) => ({ id: `V${i}`, from: 'a', to: 'b', open: false })),
};
const ro5 = reopen(eightClosedNet, ['a'], ['b'], { a: 3 }, { b: 9 });
check('恰好 8 个待开阀门可规划', ro5.status === 'ok' && ro5.closedValveCount === 8);
check('并行 8 管、供给上限 3：每步获配 1,2,3,3,3,3,3,3',
  ro5.steps.map((s) => s.totalAllocated).join(',') === '1,2,3,3,3,3,3,3');
check('目标值 21、最终获配 3', ro5.objective === 21 && ro5.finalAllocated === 3);
check('全部同分时顺序按编号升序', ro5.finalOrder.join(',') === 'V0,V1,V2,V3,V4,V5,V6,V7');

console.log('复水规划：已关自环阀在清单中但不改变获配：');
const loopNet = {
  nodes: ['S', 'O'],
  pipes: [],
  valvedPipes: [
    { id: 'V1', from: 'S', to: 'O', open: true },
    { id: 'V9', from: 'S', to: 'S', open: false }, // 已关自环
  ],
};
const ro6 = reopen(loopNet, ['S'], ['O'], { S: 5 }, { O: 5 });
check('已关自环阀计入待开清单', ro6.status === 'ok' && ro6.closedValveCount === 1 &&
  ro6.finalOrder.join(',') === 'V9');
check('开启自环阀不改变总获配（仍为 1）', ro6.baselineAllocated === 1 &&
  ro6.finalAllocated === 1 && ro6.steps[0].totalAllocated === 1);

console.log('复水规划：校验与纯函数：');
const roe1 = reopen(network, ['S1'], ['B'], { S1: -1 }, { B: 1 });
check('负整数上限被拒绝', roe1.status === 'invalid' && roe1.errors.some((e) => e.includes('非负整数')));
const roe2 = reopen(network, ['NOPE'], ['B'], { NOPE: 1 }, { B: 1 });
check('供水点不存在时报错', roe2.status === 'invalid');
const roe3 = reopen(network, ['S1'], [], { S1: 1 }, {});
check('缺少出口时报错', roe3.status === 'invalid');
const beforeReopen = JSON.stringify(reopenNet);
solver.planReopenSequence(reopenNet, { supplies: ['S'], outlets: ['O'], supplyCaps: { S: 5 }, outletDemands: { O: 5 } });
check('规划不修改输入网络与登记状态', JSON.stringify(reopenNet) === beforeReopen);

// ============ 关阀作业路线 ============
console.log('关阀作业路线：');

// 步行网络（与供水管网独立）：
//         3        4        5
//   大门 ─── 路口A ─── N1井 ─── N2井
//    │                 │         │
//    8                6│        5│
//    │                 │         │
//   路口B ──4── N3井 ──── N4井 ───┘
//   阀门映射 V1=N1井 V2=N2井 V3=N3井 V4=N4井
const routeNet = {
  nodes: ['S', 'O'],
  pipes: [],
  valvedPipes: [
    { id: 'V1', from: 'S', to: 'O', open: true },
    { id: 'V2', from: 'S', to: 'O', open: true },
    { id: 'V3', from: 'S', to: 'O', open: true },
    { id: 'V4', from: 'S', to: 'O', open: false },
    { id: 'V5', from: 'S', to: 'O', open: true },
  ],
};
const passage = {
  waypoints: ['大门', '路口A', '路口B', 'N1井', 'N2井', 'N3井', 'N4井'],
  passages: [
    { id: 'W1', from: '大门', to: '路口A', minutes: 3 },
    { id: 'W2', from: '大门', to: '路口B', minutes: 8 },
    { id: 'W3', from: '路口A', to: 'N1井', minutes: 4 },
    { id: 'W4', from: 'N1井', to: 'N2井', minutes: 5 },
    { id: 'W5', from: 'N2井', to: 'N4井', minutes: 5 },
    { id: 'W6', from: 'N4井', to: 'N3井', minutes: 5 },
    { id: 'W7', from: 'N3井', to: '路口B', minutes: 4 },
    { id: 'W8', from: 'N3井', to: 'N1井', minutes: 6 },
  ],
  valveWaypoints: { V1: 'N1井', V2: 'N2井', V3: 'N3井', V4: 'N4井', V5: 'N1井' },
};
const planRoute = (closedValves, start, psg = passage, net = routeNet) =>
  solver.planClosureRoute({ network: net, closedValves, passage: psg, start });

// 必访 V1、V2（d(大门,N1)=7, d(N1,N2)=5, d(N2,大门)=15）→ 24；
// 反向顺序 V2,V1：12 + 5 + 7 = 24，同分按字典序取 [V1,V2]
const rt1 = planRoute(['V2', 'V1'], '大门');
check('返回 ok', rt1.status === 'ok');
check('必访阀门去重排序后为 2 个', rt1.requiredValveCount === 2);
check('同耗时按阀门编号字典序取 [V1,V2]', rt1.valveOrder.join(',') === 'V1,V2');
check('总耗时 24 分钟', rt1.totalMinutes === 24);
check('段数 = 必访数 + 1 = 3', rt1.segments.length === 3);
check('段落类型 出发/转场/返程',
  rt1.segments.map((s) => s.kind).join(',') === 'depart,between,return');
check('各段操作阀门依次为 V1、V2、null',
  rt1.segments[0].valve === 'V1' && rt1.segments[1].valve === 'V2' && rt1.segments[2].valve === null);
check('各段耗时 7、5、12（返程 N2→大门=12）',
  rt1.segments.map((s) => s.minutes).join(',') === '7,5,12');
check('各段实际通道路点正确（返程与去程重复经过 N1井、路口A）',
  rt1.segments[0].path.join('→') === '大门→路口A→N1井' &&
  rt1.segments[1].path.join('→') === 'N1井→N2井' &&
  rt1.segments[2].path.join('→') === 'N2井→N1井→路口A→大门');
check('相邻段衔接点一致（允许重复经过路点）',
  rt1.segments[0].path.at(-1) === rt1.segments[1].path[0] &&
  rt1.segments[1].path.at(-1) === rt1.segments[2].path[0]);

console.log('作业路线：同耗时不同顺序由字典序裁决：');
// 单阀门 V5 与 V1 同点：必访 [V1,V5] 时两点相同，总耗时 = 7+0+7 = 14
const rt1b = planRoute(['V5', 'V1'], '大门');
check('同点阀门之间转场耗时 0、实际路径只有一个路点',
  rt1b.status === 'ok' && rt1b.totalMinutes === 14 &&
  rt1b.segments[1].minutes === 0 && rt1b.segments[1].path.join(',') === 'N1井');
check('操作顺序 [V1,V5]（字典序最小）', rt1b.valveOrder.join(',') === 'V1,V5');

console.log('作业路线：并行通道取最短，最短路等耗时按路点序列字典序：');
const tiePsg = {
  waypoints: ['大门', 'A井', 'B井', 'M'],
  passages: [
    { from: '大门', to: 'A井', minutes: 5 },
    { from: '大门', to: 'B井', minutes: 5 },
    { from: 'A井', to: 'M', minutes: 2 },
    { from: 'B井', to: 'M', minutes: 2 },
  ],
  valveWaypoints: { V1: 'M' },
};
const rt2 = planRoute(['V1'], '大门', tiePsg);
check('等耗时最短路取路点序列字典序（大门→A井→M）',
  rt2.status === 'ok' && rt2.totalMinutes === 14 &&
  rt2.segments[0].path.join('→') === '大门→A井→M' &&
  rt2.segments[1].path.join('→') === 'M→A井→大门');
// 并行通道：大门—A井 两条，取分钟较小者
const parallelPsg = {
  waypoints: ['大门', 'A井'],
  passages: [
    { from: '大门', to: 'A井', minutes: 9 },
    { from: 'A井', to: '大门', minutes: 3 },
  ],
  valveWaypoints: { V1: 'A井' },
};
const rt2b = planRoute(['V1'], '大门', parallelPsg);
check('同名端点并行通道取最小分钟（3，往返 6）', rt2b.totalMinutes === 6);

console.log('作业路线：子集动态规划选择真正最优访问顺序：');
// 大门—N1=7, 大门—N3=12；若先远后近：V3(12)+N3→N1(6)+V1(7)=25；
// 先近后远 V1,V3：7 + 6 + 12 = 25（本例同构对称，同分时取 [V1,V3]）
const rt3 = planRoute(['V3', 'V1'], '大门');
check('两阀场景总耗时 25、顺序 [V1,V3]',
  rt3.status === 'ok' && rt3.totalMinutes === 25 && rt3.valveOrder.join(',') === 'V1,V3');
// 构造非对称：N3 更近 → 应先访问 N3（V3）
const asymPsg = {
  waypoints: ['大门', '近点', '远点', '中点'],
  passages: [
    { from: '大门', to: '近点', minutes: 1 },
    { from: '近点', to: '中点', minutes: 2 },
    { from: '中点', to: '远点', minutes: 2 },
  ],
  valveWaypoints: { V1: '远点', V3: '近点', V4: '中点' },
};
// V3=近点(1), V4=中点(3), V1=远点(5)，三点在同一条直线上：
// 先去最远再原路返回（[V1,V4,V3]）或反向（[V3,V4,V1]）都只需走两遍全程 = 10；
// 同分按阀门编号序列字典序取 [V1,V4,V3]
const rt3b = planRoute(['V1', 'V4', 'V3'], '大门', asymPsg);
check('三阀直线场景总耗时 10、顺序 [V1,V4,V3]（字典序最小）',
  rt3b.status === 'ok' && rt3b.totalMinutes === 10 && rt3b.valveOrder.join(',') === 'V1,V4,V3');

console.log('作业路线：重复经过路点 / 通道：');
// 死胡同：V1 在支路尽头，V2 在另一支路尽头，必经大门中转
const deadPsg = {
  waypoints: ['大门', 'X', 'Y'],
  passages: [
    { from: '大门', to: 'X', minutes: 2 },
    { from: '大门', to: 'Y', minutes: 3 },
  ],
  valveWaypoints: { V1: 'X', V2: 'Y' },
};
const rt4 = planRoute(['V2', 'V1'], '大门', deadPsg);
check('死胡同往返：总耗时 2+2+3+3=10', rt4.status === 'ok' && rt4.totalMinutes === 10);
check('路线重复经过大门与通道（V1→V2 经大门）',
  rt4.segments[1].path.join('→') === 'X→大门→Y' && rt4.segments[1].minutes === 5);

console.log('作业路线：映射缺失：');
const missPsg = { waypoints: passage.waypoints, passages: passage.passages, valveWaypoints: { V1: 'N1井' } };
const rt5 = planRoute(['V1', 'V2'], '大门', missPsg);
check('缺少 V2 映射返回 missing-map', rt5.status === 'missing-map' &&
  rt5.missingValves.join(',') === 'V2' && rt5.reason.includes('V2'));
const rt5b = planRoute(['V1', 'V3', 'V4'], '大门', missPsg);
check('多个缺失阀门按编号升序列出', rt5b.status === 'missing-map' &&
  rt5b.missingValves.join(',') === 'V3,V4');
// 映射到的阀门不在方案中不报错（多余映射忽略）
const extraPsg = {
  waypoints: passage.waypoints,
  passages: passage.passages,
  valveWaypoints: { V1: 'N1井', V99: 'N1井' },
};
check('多余的阀门映射被忽略', planRoute(['V1'], '大门', extraPsg).status === 'ok');

console.log('作业路线：必访阀门数量上限：');
const manyRouteNet = {
  nodes: ['a', 'b'],
  pipes: [],
  valvedPipes: Array.from({ length: 9 }, (_, i) => ({ id: `V${i}`, from: 'a', to: 'b', open: true })),
};
const manyPsg = {
  waypoints: ['a'],
  passages: [],
  valveWaypoints: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`V${i}`, 'a'])),
};
const rt6 = planRoute(Array.from({ length: 9 }, (_, i) => `V${i}`), 'a', manyPsg, manyRouteNet);
check('9 个必访阀门被拒绝（too-many）', rt6.status === 'too-many' &&
  rt6.requiredValveCount === 9 && rt6.reason.includes('9') && rt6.reason.includes('8'));
const eightPsg = {
  waypoints: ['a'],
  passages: [],
  valveWaypoints: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`V${i}`, 'a'])),
};
const eightNet = {
  nodes: ['a', 'b'],
  pipes: [],
  valvedPipes: Array.from({ length: 8 }, (_, i) => ({ id: `V${i}`, from: 'a', to: 'b', open: true })),
};
check('恰好 8 个必访阀门可规划（全部同点，总耗时 0）',
  planRoute(Array.from({ length: 8 }, (_, i) => `V${i}`), 'a', eightPsg, eightNet).status === 'ok');

console.log('作业路线：无路可达：');
const islandPsg = {
  waypoints: ['大门', 'X', '孤岛'],
  passages: [{ from: '大门', to: 'X', minutes: 2 }],
  valveWaypoints: { V1: 'X', V2: '孤岛' },
};
const rt7 = planRoute(['V1', 'V2'], '大门', islandPsg);
check('孤岛阀门返回 unreachable', rt7.status === 'unreachable' &&
  rt7.pairs.some((p) => p.from.includes('大门') && p.to.includes('V2')));
// 出发点孤岛（全部阀门在另一连通块）
const islandStartPsg = {
  waypoints: ['大门', 'X'],
  passages: [],
  valveWaypoints: { V1: 'X' },
};
const rt7b = planRoute(['V1'], '大门', islandStartPsg);
check('出发点与阀门不通返回 unreachable', rt7b.status === 'unreachable' && rt7b.pairs.length === 1);
// 阀门之间不通但都与出发点不通：逐对列出
const twoIslandPsg = {
  waypoints: ['大门', 'X', 'Y'],
  passages: [{ from: '大门', to: 'X', minutes: 1 }],
  valveWaypoints: { V1: 'X', V2: 'Y' },
};
const rt7c = planRoute(['V1', 'V2'], '大门', twoIslandPsg);
check('不可达对全部列出（出发-V2 与 V1-V2 共 2 对）', rt7c.status === 'unreachable' && rt7c.pairs.length === 2);

console.log('作业路线：无需关阀（空方案）：');
const rt8 = planRoute([], '大门');
check('空必访清单返回 ok、总耗时 0', rt8.status === 'ok' &&
  rt8.requiredValveCount === 0 && rt8.valveOrder.length === 0 &&
  rt8.segments.length === 0 && rt8.totalMinutes === 0);

console.log('作业路线：作业通道 JSON 解析校验：');
const good = solver.parseWorkPassage({
  waypoints: ['a', 'b'],
  passages: [{ id: 'w1', from: 'a', to: 'b', minutes: 1 }],
  valveWaypoints: { V1: 'a' },
});
check('合法作业通道解析成功', !!good.passage && good.errors.length === 0);
const eWp = solver.parseWorkPassage({ waypoints: [], passages: [], valveWaypoints: {} });
check('空路点被拒绝', !eWp.passage && eWp.errors.some((e) => e.includes('waypoints')));
const eDup = solver.parseWorkPassage({ waypoints: ['a', 'a'], passages: [], valveWaypoints: {} });
check('重复路点被拒绝', eDup.errors.some((e) => e.includes('重复')));
const ePsg = solver.parseWorkPassage({
  waypoints: ['a', 'b'],
  passages: [{ from: 'a', to: 'b' }],
  valveWaypoints: {},
});
check('缺少 minutes 被拒绝', ePsg.errors.some((e) => e.includes('minutes')));
const eMin = solver.parseWorkPassage({
  waypoints: ['a', 'b'],
  passages: [{ from: 'a', to: 'b', minutes: 0 }],
  valveWaypoints: {},
});
check('minutes 非正整数被拒绝', eMin.errors.some((e) => e.includes('正整数')));
const eFloat = solver.parseWorkPassage({
  waypoints: ['a', 'b'],
  passages: [{ from: 'a', to: 'b', minutes: 2.5 }],
  valveWaypoints: {},
});
check('minutes 小数被拒绝', eFloat.errors.some((e) => e.includes('正整数')));
const eEnd = solver.parseWorkPassage({
  waypoints: ['a'],
  passages: [{ from: 'a', to: 'z', minutes: 1 }],
  valveWaypoints: {},
});
check('通道端点未声明被拒绝', eEnd.errors.some((e) => e.includes('未在 waypoints')));
const eMap = solver.parseWorkPassage({
  waypoints: ['a'],
  passages: [],
  valveWaypoints: { V1: 'z' },
});
check('阀门映射路点未声明被拒绝', eMap.errors.some((e) => e.includes('V1')));
const eType = solver.parseWorkPassage('nope');
check('非对象 JSON 被拒绝', !eType.passage && eType.errors.length > 0);

console.log('作业路线：查询校验与纯函数：');
const rte1 = planRoute(['V1'], '不是路点');
check('出发路点未声明报错', rte1.status === 'invalid' && rte1.errors.some((e) => e.includes('出发路点')));
const rte2 = planRoute(['V1'], '  ');
check('出发路点为空报错', rte2.status === 'invalid');
const rte3 = planRoute(['VX'], '大门');
check('待关闭阀门不在拓扑中报错', rte3.status === 'invalid' && rte3.errors.some((e) => e.includes('VX')));
const beforeRouteNet = JSON.stringify(routeNet);
const beforeRoutePsg = JSON.stringify(passage);
const closedInput = ['V2', 'V1'];
planRoute(closedInput, '大门');
check('路线测算不修改拓扑', JSON.stringify(routeNet) === beforeRouteNet);
check('路线测算不修改作业通道输入', JSON.stringify(passage) === beforeRoutePsg);
check('路线测算不修改待关闭阀门入参数组', closedInput.join(',') === 'V2,V1');

console.log('作业路线：大分钟精确整数（超出 Number 安全整数范围）：');
// 「门→中继」9007199254740991 分钟（安全整数上限）、「中继→阀位」2 分钟：
// 单程 9007199254740993、单阀往返 18014398509481986，均超出 Number 安全整数范围；
// Number 累加会舍入（9007199254740991 + 2 → 9007199254740992），必须按精确整数计算。
const bigPsg = {
  waypoints: ['门', '中继', '阀位'],
  passages: [
    { from: '门', to: '中继', minutes: 9007199254740991 },
    { from: '中继', to: '阀位', minutes: 2 },
  ],
  valveWaypoints: { V1: '阀位' },
};
const rtBig = planRoute(['V1'], '门', bigPsg);
check('单阀往返精确为 18014398509481986（完整十进制字符串）',
  rtBig.status === 'ok' && rtBig.totalMinutes === '18014398509481986');
check('逐段耗时精确（去程 / 返程各 9007199254740993）',
  rtBig.segments.map((s) => s.minutes).join(',') === '9007199254740993,9007199254740993');
check('大分钟路线实际通道路点正确',
  rtBig.segments[0].path.join('→') === '门→中继→阀位' &&
  rtBig.segments[1].path.join('→') === '阀位→中继→门');
// 分段恰为安全整数上限 9007199254740991 时仍返回 number，往返总和超出范围才返回字符串
const maxSafePsg = {
  waypoints: ['门', '阀位'],
  passages: [{ from: '门', to: '阀位', minutes: 9007199254740991 }],
  valveWaypoints: { V1: '阀位' },
};
const rtMax = planRoute(['V1'], '门', maxSafePsg);
check('分段恰为 9007199254740991（安全整数上限）保持 number',
  rtMax.status === 'ok' && rtMax.segments[0].minutes === 9007199254740991 &&
  rtMax.segments[1].minutes === 9007199254740991);
check('总耗时 18014398509481982 超出安全范围，返回完整十进制字符串',
  rtMax.totalMinutes === '18014398509481982');
// 普通分钟输入的结果保持兼容：安全范围内仍为 number（既有断言 rt1.totalMinutes === 24 等已覆盖）
check('普通分钟结果仍为 number', typeof rt1.totalMinutes === 'number' &&
  rt1.segments.every((s) => typeof s.minutes === 'number'));
// 大分钟下的多阀访问顺序优化：门—1—近点，近点—9007199254740991—远点，V1 近、V2 远
// [V1,V2]：1 + 9007199254740991 + 9007199254740992 = 18014398509481984
// [V2,V1]：9007199254740992 + 9007199254740991 + 1 = 18014398509481984（同耗时）
// 同耗时按阀门编号序列字典序取 [V1,V2]
const bigDpPsg = {
  waypoints: ['门', '近点', '远点'],
  passages: [
    { from: '门', to: '近点', minutes: 1 },
    { from: '近点', to: '远点', minutes: 9007199254740991 },
  ],
  valveWaypoints: { V1: '近点', V2: '远点' },
};
const rtBigDp = planRoute(['V2', 'V1'], '门', bigDpPsg);
check('大分钟多阀顺序优化总耗时精确（18014398509481984）',
  rtBigDp.status === 'ok' && rtBigDp.totalMinutes === '18014398509481984');
check('大分钟等耗时仍按阀门编号序列字典序取舍（[V1,V2]）',
  rtBigDp.valveOrder.join(',') === 'V1,V2');
check('大分钟多阀逐段耗时精确',
  rtBigDp.segments.map((s) => s.minutes).join(',') === '1,9007199254740991,9007199254740992');

// ============ 应急送水站布点 ============
console.log('应急送水站布点：');

// S 经单条单位容量阀门 V1 接 O：供给 5、需求 3 → 获配 1、缺口 2
const delNet = {
  nodes: ['S', 'O'],
  pipes: [],
  valvedPipes: [{ id: 'V1', from: 'S', to: 'O', open: true }],
};
const delPassage = {
  waypoints: ['gate', 'p1', 'p2', 'oport'],
  passages: [
    { id: 'W1', from: 'gate', to: 'p1', minutes: 3 },
    { id: 'W2', from: 'p1', to: 'oport', minutes: 3 },
    { id: 'W3', from: 'gate', to: 'p2', minutes: 10 },
    { id: 'W4', from: 'p2', to: 'oport', minutes: 2 },
  ],
  valveWaypoints: {},
};
const delBase = {
  supplies: ['S'],
  outlets: ['O'],
  supplyCaps: { S: 5 },
  outletDemands: { O: 3 },
  passage: delPassage,
  maxWalkMinutes: 6,
  outletWaypoints: { O: 'oport' },
};

const d1 = solver.planEmergencyDeliveryStations(delNet, { ...delBase, stations: [{ name: 'gate', capacity: 5 }] });
check('单站可补齐：ok、用 1 站、补齐 2', d1.status === 'ok' && d1.stationUsed === 1 &&
  d1.totalNeed === 2 && d1.totalDelivered === 2 &&
  d1.stations.length === 1 && d1.stations[0].name === 'gate' && d1.stations[0].used === 2);
check('逐出口分配为整数且含步行分钟', d1.rows.length === 1 &&
  d1.rows[0].remaining === 0 && d1.rows[0].byStation.length === 1 &&
  d1.rows[0].byStation[0].station === 'gate' && d1.rows[0].byStation[0].amount === 2 &&
  d1.rows[0].byStation[0].walkMinutes === 6);

const d2 = solver.planEmergencyDeliveryStations(delNet, { ...delBase, stations: [{ name: 'gate', capacity: 1 }] });
check('站容量不足：unsolvable 且列出未补齐出口', d2.status === 'unsolvable' &&
  d2.totalDelivered === 1 && d2.uncoveredOutlets.join(',') === 'O' &&
  d2.rows[0].remaining === 1);

const d3 = solver.planEmergencyDeliveryStations(delNet, {
  ...delBase,
  stations: [{ name: 'gate', capacity: 5 }],
  maxWalkMinutes: 5, // gate→oport 最短 6 分钟，超出
});
check('步行超限不可服务：unsolvable、送出 0', d3.status === 'unsolvable' &&
  d3.totalDelivered === 0 && d3.uncoveredOutlets.includes('O'));

// 两出口：A 只近 x，B 只近 y，z 经两跳可达两处（步行 2）→ 步行限制 1 时必须 2 站
const delNet2 = {
  nodes: ['S', 'A', 'B'],
  pipes: [],
  valvedPipes: [],
};
const delPassage2 = {
  waypoints: ['wA', 'wB', 'x', 'y', 'z'],
  passages: [
    { from: 'x', to: 'wA', minutes: 1 },
    { from: 'y', to: 'wB', minutes: 1 },
    { from: 'z', to: 'x', minutes: 1 },
    { from: 'z', to: 'y', minutes: 1 },
  ],
  valveWaypoints: {},
};
const d4 = solver.planEmergencyDeliveryStations(delNet2, {
  supplies: ['S'],
  outlets: ['A', 'B'],
  supplyCaps: { S: 0 },
  outletDemands: { A: 2, B: 3 },
  passage: delPassage2,
  maxWalkMinutes: 1,
  outletWaypoints: { A: 'wA', B: 'wB' },
  stations: [
    { name: 'z', capacity: 10 },
    { name: 'y', capacity: 5 },
    { name: 'x', capacity: 5 },
  ],
});
check('两出口必须两站：站数最少为 2', d4.status === 'ok' && d4.stationUsed === 2);
check('同数按站点名称升序列表字典序：[x, y] 优先于 [x, z]/[y, z]',
  d4.stations.map((s) => s.name).join(',') === 'x,y');
check('各出口整数补齐（A=2 由 x，B=3 由 y）',
  d4.rows.find((r) => r.outlet === 'A').byStation[0].station === 'x' &&
  d4.rows.find((r) => r.outlet === 'A').delivered === 2 &&
  d4.rows.find((r) => r.outlet === 'B').byStation[0].station === 'y' &&
  d4.rows.find((r) => r.outlet === 'B').delivered === 3);

// 放宽步行到 2：z 两跳可同时服务两出口，1 站即可（容量 10）
const d4b = solver.planEmergencyDeliveryStations(delNet2, {
  supplies: ['S'],
  outlets: ['A', 'B'],
  supplyCaps: { S: 0 },
  outletDemands: { A: 2, B: 3 },
  passage: delPassage2,
  maxWalkMinutes: 2,
  outletWaypoints: { A: 'wA', B: 'wB' },
  stations: [
    { name: 'z', capacity: 10 },
    { name: 'y', capacity: 5 },
    { name: 'x', capacity: 5 },
  ],
});
check('放宽步行后单站 z 可补齐（最短步行按通道计算）', d4b.status === 'ok' &&
  d4b.stationUsed === 1 && d4b.stations[0].name === 'z' && d4b.totalDelivered === 5);

// 容量共享：两出口都只由一站 z 服务，其容量 4 < 总缺口 5 → unsolvable
const d5 = solver.planEmergencyDeliveryStations(delNet2, {
  supplies: ['S'],
  outlets: ['A', 'B'],
  supplyCaps: { S: 0 },
  outletDemands: { A: 2, B: 3 },
  passage: delPassage2,
  maxWalkMinutes: 2,
  outletWaypoints: { A: 'wA', B: 'wB' },
  stations: [{ name: 'z', capacity: 4 }],
});
check('单站容量被多出口共享：送 4 后仍缺', d5.status === 'unsolvable' &&
  d5.totalDelivered === 4 && d5.uncoveredOutlets.length >= 1);

console.log('应急送水站布点：缺口为 0 与校验：');
// 无缺口：需求 0（或供给充足）→ empty
const d6 = solver.planEmergencyDeliveryStations(delNet, {
  ...delBase,
  outletDemands: { O: 0 },
  stations: [],
  maxWalkMinutes: 6,
  outletWaypoints: {},
});
check('缺口全为 0 返回 empty（无需布点）', d6.status === 'empty');

const d7 = solver.planEmergencyDeliveryStations(delNet, {
  ...delBase,
  stations: [{ name: 'ghost', capacity: 1 }],
});
check('站路点未在 waypoints 声明报错', d7.status === 'invalid' &&
  d7.errors.some((e) => e.includes('ghost')));

const d8 = solver.planEmergencyDeliveryStations(delNet, {
  ...delBase,
  stations: [{ name: 'gate', capacity: 1 }],
  outletWaypoints: {},
});
check('缺口出口缺少路点映射报错', d8.status === 'invalid' &&
  d8.errors.some((e) => e.includes('O')));

const d9Passage = {
  waypoints: Array.from({ length: 9 }, (_, i) => `w${i}`),
  passages: [],
  valveWaypoints: {},
};
const d9 = solver.planEmergencyDeliveryStations(delNet, {
  ...delBase,
  passage: d9Passage,
  outletWaypoints: { O: 'oport' },
  stations: Array.from({ length: 9 }, (_, i) => ({ name: `w${i}`, capacity: 1 })),
});
check('候选站超过 8 个被拒绝', d9.status === 'invalid' && d9.errors.some((e) => e.includes('8')));

const d10 = solver.planEmergencyDeliveryStations(delNet, {
  ...delBase,
  stations: [{ name: 'gate', capacity: 2.5 }],
});
check('可送水量为小数被拒绝', d10.status === 'invalid' &&
  d10.errors.some((e) => e.includes('非负整数')));

const d11 = solver.planEmergencyDeliveryStations(delNet, {
  ...delBase,
  stations: [{ name: 'gate', capacity: 5 }],
  maxWalkMinutes: -1,
});
check('最大步行分钟为负数被拒绝', d11.status === 'invalid' &&
  d11.errors.some((e) => e.includes('最大步行分钟')));

const d12 = solver.planEmergencyDeliveryStations(delNet, {
  ...delBase,
  stations: [{ name: 'gate', capacity: 5 }, { name: 'gate', capacity: 2 }],
});
check('候选站重复被拒绝', d12.status === 'invalid' && d12.errors.some((e) => e.includes('重复')));

const beforeDelNet = JSON.stringify(delNet);
const beforeDelPsg = JSON.stringify(delPassage);
const delStationsInput = [{ name: 'gate', capacity: 5 }];
solver.planEmergencyDeliveryStations(delNet, { ...delBase, stations: delStationsInput });
check('布点测算不修改拓扑', JSON.stringify(delNet) === beforeDelNet);
check('布点测算不修改作业通道输入', JSON.stringify(delPassage) === beforeDelPsg);
check('布点测算不修改候选站入参数组', delStationsInput[0].capacity === 5 && delStationsInput.length === 1);

// 供水能力填写表本身无效时透传校验错误
const d13 = solver.planEmergencyDeliveryStations(delNet, {
  supplies: ['S'],
  outlets: ['NOPE'],
  supplyCaps: { S: 5 },
  outletDemands: { NOPE: 3 },
  passage: delPassage,
  maxWalkMinutes: 6,
  outletWaypoints: { NOPE: 'oport' },
  stations: [{ name: 'gate', capacity: 5 }],
});
check('出口节点不存在时透传核验错误', d13.status === 'invalid');

// ============ 检修阀门操作时段审计 ============
console.log('检修阀门操作时段审计：');

const auditBase = { supplies: ['S1', 'S2'], leak: 'N2', outlets: ['B', 'C', 'D'] };

const au1 = solver.auditValveOperationWindow(network, {
  ...auditBase,
  startMinute: 0,
  endMinute: 40,
  records: [
    { minute: 5, valve: 'V03', open: false },
    { minute: 5, valve: 'V04', open: false },
    { minute: 5, valve: 'V05', open: false },
    { minute: 30, valve: 'V03', open: true },
    { minute: 30, valve: 'V04', open: true },
    { minute: 35, valve: 'V08', open: false },
  ],
});
check('审计返回 ok', au1.status === 'ok');
check('记录数与变更次数（6 条记录 → 3 次原子变更）',
  au1.status === 'ok' && au1.recordCount === 6 && au1.changes.length === 3);
check('漏点带压时段 [0,5) 与 [30,40)', au1.status === 'ok' &&
  au1.leakPressurizedIntervals.length === 2 &&
  au1.leakPressurizedIntervals[0].from === 0 && au1.leakPressurizedIntervals[0].to === 5 &&
  au1.leakPressurizedIntervals[1].from === 30 && au1.leakPressurizedIntervals[1].to === 40);
check('漏点带压累计 15 分钟', au1.status === 'ok' && au1.leakPressurizedMinutes === 15);
const rowOf = (r, name) => r.outletRows.find((x) => x.outlet === name);
check('出口 C 断水 [5,30) 共 25 分钟', au1.status === 'ok' &&
  rowOf(au1, 'C').outageMinutes === 25 &&
  rowOf(au1, 'C').outageIntervals.length === 1 &&
  rowOf(au1, 'C').outageIntervals[0].from === 5 &&
  rowOf(au1, 'C').outageIntervals[0].to === 30);
check('出口 D 与 C 同时段断水', au1.status === 'ok' && rowOf(au1, 'D').outageMinutes === 25);
check('出口 B 关 V08 后（V09 登记为关）断水 [35,40) 共 5 分钟', au1.status === 'ok' &&
  rowOf(au1, 'B').outageMinutes === 5 &&
  rowOf(au1, 'B').outageIntervals[0].from === 35 &&
  rowOf(au1, 'B').outageIntervals[0].to === 40);
check('断水分钟合计 55', au1.status === 'ok' && au1.totalOutageMinutes === 55);
check('时间轴分段数 = 变更数 + 1', au1.status === 'ok' && au1.segments.length === 4);
check('同分钟不同阀门合并为一次原子变更且按阀门编号升序', au1.status === 'ok' &&
  au1.changes[0].minute === 5 &&
  au1.changes[0].operations.map((o) => o.valve).join(',') === 'V03,V04,V05' &&
  au1.changes[0].operations[0].fromOpen === true &&
  au1.changes[0].operations[0].toOpen === false);

// 空日志：整段按登记状态覆盖
const au2 = solver.auditValveOperationWindow(network, {
  ...auditBase,
  startMinute: 0,
  endMinute: 40,
  records: [],
});
check('空日志返回 ok 且零变更', au2.status === 'ok' && au2.changes.length === 0 && au2.segments.length === 1);
check('空日志漏点整段带压 [0,40)', au2.status === 'ok' &&
  au2.leakPressurizedIntervals.length === 1 &&
  au2.leakPressurizedIntervals[0].from === 0 &&
  au2.leakPressurizedIntervals[0].to === 40 &&
  au2.leakPressurizedMinutes === 40);
check('空日志各出口不断水', au2.status === 'ok' && au2.totalOutageMinutes === 0);

// 相邻同类区间合并：关 V07（仅影响叶子 D），漏点全程带压 → 合并为单段 [0,40)
const au3 = solver.auditValveOperationWindow(network, {
  ...auditBase,
  startMinute: 0,
  endMinute: 40,
  records: [
    { minute: 5, valve: 'V07', open: false },
    { minute: 10, valve: 'V07', open: true },
  ],
});
check('漏点不受影响时带压时段相邻合并为 [0,40)', au3.status === 'ok' &&
  au3.leakPressurizedIntervals.length === 1 &&
  au3.leakPressurizedIntervals[0].from === 0 &&
  au3.leakPressurizedIntervals[0].to === 40);
check('出口 D 断水 [5,10) 共 5 分钟', au3.status === 'ok' && rowOf(au3, 'D').outageMinutes === 5);

// 无变化操作（开→开）仍记录为一次变更
const au4 = solver.auditValveOperationWindow(network, {
  ...auditBase,
  startMinute: 0,
  endMinute: 10,
  records: [{ minute: 3, valve: 'V01', open: true }],
});
check('目标状态与当前相同的操作仍记一次变更', au4.status === 'ok' &&
  au4.changes.length === 1 &&
  au4.changes[0].operations[0].fromOpen === true &&
  au4.changes[0].operations[0].toOpen === true);

// 零长度区间 [5,5)
const au5 = solver.auditValveOperationWindow(network, {
  ...auditBase,
  startMinute: 5,
  endMinute: 5,
  records: [],
});
check('零长度区间返回 ok、总分钟 0、无分段', au5.status === 'ok' &&
  au5.totalMinutes === 0 && au5.segments.length === 0 && au5.leakPressurizedMinutes === 0);

// 错误：同分钟重复操作同一阀门
const eu1 = solver.auditValveOperationWindow(network, {
  ...auditBase,
  startMinute: 0,
  endMinute: 40,
  records: [
    { minute: 5, valve: 'V03', open: false },
    { minute: 5, valve: 'V03', open: true },
  ],
});
check('同分钟重复操作同一阀门报错', eu1.status === 'invalid' &&
  eu1.errors.some((x) => x.includes('重复') && x.includes('V03')));

// 错误：未知阀门
const eu2 = solver.auditValveOperationWindow(network, {
  ...auditBase,
  startMinute: 0,
  endMinute: 40,
  records: [{ minute: 5, valve: 'V99', open: false }],
});
check('未知阀门报错', eu2.status === 'invalid' && eu2.errors.some((x) => x.includes('V99')));

// 错误：越界时间（分钟 = 结束分钟，区间左闭右开）
const eu3 = solver.auditValveOperationWindow(network, {
  ...auditBase,
  startMinute: 0,
  endMinute: 40,
  records: [{ minute: 40, valve: 'V03', open: false }],
});
check('分钟等于结束分钟（右边界）报越界', eu3.status === 'invalid' && eu3.errors.some((x) => x.includes('越界')));
const eu3b = solver.auditValveOperationWindow(network, {
  ...auditBase,
  startMinute: 10,
  endMinute: 40,
  records: [{ minute: 9, valve: 'V03', open: false }],
});
check('分钟早于起始分钟报越界', eu3b.status === 'invalid' && eu3b.errors.some((x) => x.includes('越界')));

// 错误：起 > 止、非整数、open 非布尔、记录超 100 条
const eu4 = solver.auditValveOperationWindow(network, {
  ...auditBase, startMinute: 40, endMinute: 10, records: [],
});
check('起始晚于结束报错', eu4.status === 'invalid');
const eu5 = solver.auditValveOperationWindow(network, {
  ...auditBase, startMinute: 1.5, endMinute: 10, records: [],
});
check('起始分钟为小数报错', eu5.status === 'invalid');
const eu6 = solver.auditValveOperationWindow(network, {
  ...auditBase,
  startMinute: 0,
  endMinute: 40,
  records: [{ minute: 5, valve: 'V03', open: 'false' }],
});
check('open 非布尔报错', eu6.status === 'invalid' && eu6.errors.some((x) => x.includes('open')));
const eu7 = solver.auditValveOperationWindow(network, {
  ...auditBase,
  startMinute: 0,
  endMinute: 1000,
  records: Array.from({ length: 101 }, (_, i) => ({ minute: i, valve: 'V03', open: i % 2 === 0 })),
});
check('记录超过 100 条报错', eu7.status === 'invalid' && eu7.errors.some((x) => x.includes('100')));

// 保供出口顺序按查询去重顺序给出
const au6 = solver.auditValveOperationWindow(network, {
  supplies: ['S1', 'S2'],
  leak: 'N2',
  outlets: ['D', 'D', 'C', 'B'],
  startMinute: 0,
  endMinute: 40,
  records: [{ minute: 5, valve: 'V07', open: false }],
});
check('出口按查询顺序去重', au6.status === 'ok' &&
  au6.outlets.join(',') === 'D,C,B' &&
  au6.outletRows.map((r) => r.outlet).join(',') === 'D,C,B');

// 纯函数：不修改拓扑与登记状态、不修改入参记录
const beforeAuditNet = JSON.stringify(network);
const auditRecordsInput = [
  { minute: 5, valve: 'V03', open: false },
  { minute: 30, valve: 'V03', open: true },
];
solver.auditValveOperationWindow(network, {
  ...auditBase, startMinute: 0, endMinute: 40, records: auditRecordsInput,
});
check('审计不修改拓扑与登记状态', JSON.stringify(network) === beforeAuditNet);
check('审计不修改入参记录', auditRecordsInput.length === 2 &&
  auditRecordsInput[0].minute === 5 && auditRecordsInput[0].open === false);

// ============ 特殊名称（toString / constructor / __proto__）防护 ============
console.log('特殊名称：阀门编号为继承属性名时不误判路点映射：');
// 拓扑允许阀门编号取 toString / constructor / __proto__ 等字符串
const specialRouteNet = {
  nodes: ['g', 'w'],
  pipes: [],
  valvedPipes: ['toString', 'constructor', '__proto__'].map((id) => ({
    id, from: 'g', to: 'w', open: true,
  })),
};
// 经 JSON.parse 构造（与页面一致）：一个映射都没有
const specialPsgEmpty = solver.parseWorkPassage(JSON.parse(JSON.stringify({
  waypoints: ['大门', '井A'],
  passages: [{ from: '大门', to: '井A', minutes: 3 }],
  valveWaypoints: {},
})));
check('空 valveWaypoints 解析成功', specialPsgEmpty.errors.length === 0 && !!specialPsgEmpty.passage);
for (const v of ['toString', 'constructor', '__proto__']) {
  const r = solver.planClosureRoute({
    network: specialRouteNet, closedValves: [v], passage: specialPsgEmpty.passage, start: '大门',
  });
  check(`缺失「${v}」映射返回 missing-map（不抛错）`,
    r.status === 'missing-map' && r.missingValves.join(',') === v);
}
// 三个同时缺失：全部按编号列出
const rAllMiss = solver.planClosureRoute({
  network: specialRouteNet,
  closedValves: ['toString', 'constructor', '__proto__'],
  passage: specialPsgEmpty.passage,
  start: '大门',
});
check('多个特殊名称阀门缺失时全部列出',
  rAllMiss.status === 'missing-map' && rAllMiss.missingValves.length === 3);

// 显式配置这些名称的映射：经 JSON.parse 得到真实自有键（含 __proto__）
const specialPsgFull = solver.parseWorkPassage(JSON.parse(
  '{"waypoints":["大门","井A"],' +
  '"passages":[{"from":"大门","to":"井A","minutes":3}],' +
  '"valveWaypoints":{"toString":"井A","constructor":"井A","__proto__":"井A"}}'
));
check('特殊名称映射全部被识别为实际提供的键',
  specialPsgFull.errors.length === 0 &&
  ['toString', 'constructor', '__proto__'].every((k) =>
    Object.keys(specialPsgFull.passage.valveWaypoints).includes(k)));
check('显式 __proto__ 键不污染映射对象原型（原型为 null）',
  Object.getPrototypeOf(specialPsgFull.passage.valveWaypoints) === null);
for (const v of ['toString', 'constructor', '__proto__']) {
  const r = solver.planClosureRoute({
    network: specialRouteNet, closedValves: [v], passage: specialPsgFull.passage, start: '大门',
  });
  check(`显式配置「${v}」时关阀步行路线可计算（往返 6 分钟）`,
    r.status === 'ok' && r.totalMinutes === 6 &&
    r.segments[0].path.join('→') === '大门→井A' &&
    r.valveWaypoints[v] === '井A');
}
const rAllOk = solver.planClosureRoute({
  network: specialRouteNet,
  closedValves: ['toString', 'constructor', '__proto__'],
  passage: specialPsgFull.passage,
  start: '大门',
});
check('三个特殊名称阀门同点时路线仍可计算（总步行 6 分钟）',
  rAllOk.status === 'ok' && rAllOk.requiredValveCount === 3 && rAllOk.totalMinutes === 6);
// 普通名称阀门不被特殊键影响：只有 V1 映射时要求 toString 仍报缺失
const mixedPsg = solver.parseWorkPassage({
  waypoints: ['大门', '井A'],
  passages: [{ from: '大门', to: '井A', minutes: 3 }],
  valveWaypoints: { V9: '井A' },
});
const specialNetExtra = {
  nodes: ['g', 'w'],
  pipes: [],
  valvedPipes: [{ id: 'V9', from: 'g', to: 'w', open: true }],
};
check('继承属性名不被当作映射（V9 有映射、toString 无映射）',
  solver.planClosureRoute({
    network: specialNetExtra, closedValves: ['V9'], passage: mixedPsg.passage, start: '大门',
  }).status === 'ok');

console.log('特殊名称：保供出口名为继承属性名时的送水站布点：');
const specialDelNet = {
  nodes: ['S', 'toString', 'constructor', '__proto__'],
  pipes: [],
  valvedPipes: [],
};
const specialDelQuery = (outletWaypointsText, maxWalkMinutes = 6) => ({
  supplies: ['S'],
  outlets: ['toString', 'constructor', '__proto__'],
  supplyCaps: { S: 0 },
  // 经 JSON.parse 构造，使 __proto__ 成为真实自有键
  outletDemands: JSON.parse('{"toString":3,"constructor":3,"__proto__":3}'),
  stations: [{ name: '大门', capacity: 20 }],
  maxWalkMinutes,
  outletWaypoints: JSON.parse(outletWaypointsText),
  passage: specialPsgFull.passage,
});
// 缺项：空映射对象上读取 toString / constructor / __proto__ 不得命中继承属性
const sd1 = solver.planEmergencyDeliveryStations(specialDelNet, specialDelQuery('{}'));
check('三个特殊名称出口缺映射均报可展示错误（不抛错）',
  sd1.status === 'invalid' &&
  sd1.errors.length === 3 &&
  sd1.errors.every((e) => e.includes('缺少出口取水口路点映射')) &&
  sd1.errors.some((e) => e.includes('toString')) &&
  sd1.errors.some((e) => e.includes('constructor')) &&
  sd1.errors.some((e) => e.includes('__proto__')));
// 显式配置：服务范围与整数分配均可计算
const sd2 = solver.planEmergencyDeliveryStations(
  specialDelNet,
  specialDelQuery('{"toString":"井A","constructor":"井A","__proto__":"井A"}')
);
check('显式配置特殊名称出口映射：单站补齐全部 9 个单位',
  sd2.status === 'ok' && sd2.stationUsed === 1 && sd2.totalNeed === 9 &&
  sd2.totalDelivered === 9 &&
  sd2.rows.length === 3 &&
  sd2.rows.every((r) => r.remaining === 0 && r.waypoint === '井A' &&
    r.byStation.length === 1 && r.byStation[0].walkMinutes === 3));
// 步行受限：站到取水口 3 分钟，最大步行 1 → 全部不可服务
const sd3 = solver.planEmergencyDeliveryStations(
  specialDelNet,
  specialDelQuery('{"toString":"井A","constructor":"井A","__proto__":"井A"}', 1)
);
check('特殊名称出口超出步行服务范围时列入未补齐',
  sd3.status === 'unsolvable' && sd3.totalDelivered === 0 &&
  sd3.uncoveredOutlets.length === 3);

console.log(`\n${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
