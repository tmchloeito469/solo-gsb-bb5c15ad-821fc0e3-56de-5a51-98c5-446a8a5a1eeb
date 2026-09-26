/**
 * 水路检修隔离求解器（纯函数，不修改输入）。
 *
 * 模型：管网为无向图。节点通过「无阀管段」与「带阀管段」相连。
 * 关闭一个阀门等价于从图中移除该带阀管段。
 * 目标：在「当前开启」的阀门中寻找关阀组合，使得
 *   1. 漏点与所有供水点断开；
 *   2. 每个保供出口仍能连通至少一个供水点。
 * 优选规则：关阀数最少；同数时按阀门编号排序后的列表取字典序最小。
 */

export interface Pipe {
  id: string;
  from: string;
  to: string;
}

export interface ValvedPipe extends Pipe {
  open: boolean;
}

export interface Network {
  nodes: string[];
  /** 无阀管段 */
  pipes: Pipe[];
  /** 带阀管段，阀门编号 id 全网唯一 */
  valvedPipes: ValvedPipe[];
}

export interface Query {
  /** 供水点节点 */
  supplies: string[];
  /** 漏点节点 */
  leak: string;
  /** 必须不断水的出口节点 */
  outlets: string[];
}

export interface OutletStatus {
  outlet: string;
  connected: boolean;
  /** 该出口当前能连通的供水点 */
  reachableSupplies: string[];
}

export interface Solution {
  /** 需要关闭的阀门编号（升序） */
  closed: string[];
  leakIsolated: boolean;
  outletStatus: OutletStatus[];
}

export interface SolveOk {
  status: 'ok';
  openValveCount: number;
  minClosed: number;
  /** 全部最优（关阀数最少）方案，按字典序排列 */
  solutions: Solution[];
  /** 最优方案总数超过展示上限时为 true */
  truncated: boolean;
}

export interface SolveNoSolution {
  status: 'no-solution';
  openValveCount: number;
  reason: string;
}

export interface SolveInvalid {
  status: 'invalid';
  errors: string[];
}

export type SolveResult = SolveOk | SolveNoSolution | SolveInvalid;

/** 一条参与韧性评估的管段（无阀管段或当前开启的带阀管段）。 */
export interface ActiveEdge {
  id: string;
  from: string;
  to: string;
}

/** 可按管段失效评估的出口。 */
export interface ResilienceRow {
  outlet: string;
  assessable: true;
  /** 使其失去全部供水至少需失效的不同管段数；当前已断水时为 0 */
  minFailures: number;
  /** 当前是否已断水（在当前阀门开闭状态下无任何供水点可达） */
  alreadyCut: boolean;
  /** 一组达到 minFailures 的管段编号（升序）；已断水时为空清单 */
  witnessPipes: string[];
}

/** 出口与供水点同名，无法按管段失效评估。 */
export interface ResilienceUnassessableRow {
  outlet: string;
  assessable: false;
  reason: string;
}

export type ResilienceResultRow = ResilienceRow | ResilienceUnassessableRow;

export interface ResilienceOk {
  status: 'ok';
  /** 参与评估的管段总数（无阀管段 + 当前开启的带阀管段；自环不计） */
  activePipeCount: number;
  /** 按所需失效数升序（无法评估的排在最后） */
  rows: ResilienceResultRow[];
}

export interface ResilienceInvalid {
  status: 'invalid';
  errors: string[];
}

export type ResilienceResult = ResilienceOk | ResilienceInvalid;

// ============ 供水能力核验 ============

export interface CapacityQuery {
  /** 供水点节点 */
  supplies: string[];
  /** 保供出口节点 */
  outlets: string[];
  /** 供水点节点名 -> 供给上限（非负整数） */
  supplyCaps: Record<string, number>;
  /** 保供出口节点名 -> 需求量（非负整数） */
  outletDemands: Record<string, number>;
  /**
   * 重点保供出口节点名（须包含在 outlets 中），缺省或空数组表示全部按普通出口处理。
   * 仅「重点出口优先配水」使用；供水能力核验与增容建议忽略本字段。
   */
  priorityOutlets?: string[];
}

/** 最小割项目类型：供水点供给上限 / 连通管段 / 出口需求。 */
export type CapacityCutKind = 'supply' | 'pipe' | 'demand';

export interface CapacityCutItem {
  kind: CapacityCutKind;
  /** 供给上限与出口需求为节点名，管段为管段（含阀门）编号 */
  id: string;
  /** 该项对总供给的限制容量：上限值 / 1 / 需求量 */
  capacity: number;
}

export interface CapacitySupplyRow {
  supply: string;
  cap: number;
  /** 最大分配下该供水点实际供出量 */
  used: number;
}

export interface CapacityOutletRow {
  outlet: string;
  demand: number;
  /** 最大分配下该出口获配量 */
  allocated: number;
  /** 缺口 = 需求量 - 获配量 */
  shortfall: number;
  fullySupplied: boolean;
}

export interface CapacityOk {
  status: 'ok';
  /** 参与输水的管段总数（无阀管段 + 当前开启的带阀管段；自环不计） */
  activePipeCount: number;
  totalSupplyCap: number;
  totalDemand: number;
  /** 总供给最大分配（最大流） */
  totalAllocated: number;
  /** 总缺口 = 总需求 - 总获配 */
  totalShortfall: number;
  supplyRows: CapacitySupplyRow[];
  rows: CapacityOutletRow[];
  /**
   * 一组限制总供给的最小割项目（容量合计恒等于总获配）。
   * 最大流为 0 时为空清单。
   */
  cutItems: CapacityCutItem[];
  cutCapacity: number;
}

export interface CapacityInvalid {
  status: 'invalid';
  errors: string[];
}

export type CapacityResult = CapacityOk | CapacityInvalid;

// ============ 重点出口优先配水 ============

/** 出口配水类别：重点（优先满足）/ 普通。 */
export type OutletCategory = 'priority' | 'normal';

export interface PriorityCapacityOutletRow {
  outlet: string;
  /** 重点 / 普通 */
  category: OutletCategory;
  demand: number;
  /** 两级目标下该出口获配量 */
  allocated: number;
  /** 缺口 = 需求量 - 获配量 */
  shortfall: number;
  fullySupplied: boolean;
}

export interface PriorityCapacityOk {
  status: 'ok';
  /** 参与输水的管段总数（无阀管段 + 当前开启的带阀管段；自环不计） */
  activePipeCount: number;
  /** 重点出口数 */
  priorityOutletCount: number;
  totalSupplyCap: number;
  totalDemand: number;
  /** 第一级目标值：重点出口总获配量（在该模型下可达到的最大值） */
  priorityAllocated: number;
  /** 重点出口总需求与总缺口 */
  priorityDemand: number;
  priorityShortfall: number;
  /** 第二级目标值：在不减少重点总获配的前提下，全部出口总获配量（最大） */
  totalAllocated: number;
  /** 普通出口总获配量（= 总获配 - 重点获配） */
  normalAllocated: number;
  /** 总缺口 = 总需求 - 总获配 */
  totalShortfall: number;
  /** 按填写表顺序给出的各出口类别、获配量与缺口 */
  rows: PriorityCapacityOutletRow[];
}

export interface PriorityCapacityInvalid {
  status: 'invalid';
  errors: string[];
}

export type PriorityCapacityResult = PriorityCapacityOk | PriorityCapacityInvalid;

// ============ 管段增容建议 ============

/** 增容目标容量：参与输水的管段容量由 1 提至 2。 */
export const EXPANSION_TARGET_CAPACITY = 2;
/** 增容改造的管段条数上限 */
export const MAX_EXPANSION_PIPES = 2;

/** 一个增容方案：将 upgraded 中各管段容量由 1 提至 2 后的总获配情况。 */
export interface ExpansionPlan {
  /** 参与改造的管段编号（升序）；空数组表示不改造（基线） */
  upgraded: string[];
  /** 该方案下的总获配量 */
  totalAllocated: number;
  /** 相对基线（不改造）的增量 */
  gain: number;
}

export interface ExpansionOk {
  status: 'ok';
  /** 可候选改造的管段总数（无阀管段 + 当前开启的带阀管段；自环与已关阀不计） */
  activePipeCount: number;
  /** 不改造时的总获配量（与供水能力核验的总获配一致） */
  baseline: number;
  /** 推荐方案：总获配量最高 → 改造条数最少 → 管段编号列表字典序最小 */
  recommended: ExpansionPlan;
  /** 单条改造的最优方案；无候选管段时为 null */
  bestSingle: ExpansionPlan | null;
  /** 两条组合改造的最优方案；候选不足两条时为 null */
  bestPair: ExpansionPlan | null;
}

export interface ExpansionInvalid {
  status: 'invalid';
  errors: string[];
}

export type ExpansionResult = ExpansionOk | ExpansionInvalid;

/** 参与组合的开启阀门数量上限 */
export const MAX_OPEN_VALVES = 12;
/** 收集的最优方案数上限（防止结果爆炸） */
export const MAX_SOLUTIONS = 100;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 只认对象自身（JSON 实际提供）的键：阀门编号 / 出口名允许取
 * 「toString」「constructor」「__proto__」等字符串，不能把原型链上的
 * 继承属性误判为已提供的映射。
 */
function hasOwnKey(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * 建立无原型的键值表：向其中写入「__proto__」等键只会形成普通自有属性，
 * 不会触发原型设置器；读取时也不会命中 toString 等继承属性。
 */
function createNullProtoRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function asStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  if (!v.every((x) => typeof x === 'string' && x.length > 0)) return null;
  return v as string[];
}

/** 解析并校验拓扑 JSON，返回网络或错误列表。 */
export function parseNetwork(raw: unknown): { network?: Network; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(raw)) {
    return { errors: ['拓扑 JSON 必须是一个对象，包含 nodes / pipes / valvedPipes 三个字段。'] };
  }

  const nodes = asStringArray(raw.nodes);
  if (!nodes || nodes.length === 0) {
    errors.push('nodes 必须是非空字符串数组。');
  }
  const nodeSet = new Set(nodes ?? []);
  if (nodes && nodeSet.size !== nodes.length) {
    errors.push('nodes 中存在重复节点。');
  }

  const parsePipes = (v: unknown, field: string, requireOpen: boolean): (Pipe[] | ValvedPipe[] | null) => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) {
      errors.push(`${field} 必须是数组。`);
      return null;
    }
    const out: (Pipe | ValvedPipe)[] = [];
    for (let i = 0; i < v.length; i++) {
      const p = v[i];
      if (!isRecord(p) || typeof p.id !== 'string' || !p.id ||
          typeof p.from !== 'string' || !p.from ||
          typeof p.to !== 'string' || !p.to) {
        errors.push(`${field}[${i}] 必须包含非空字符串字段 id / from / to。`);
        continue;
      }
      if (requireOpen && typeof p.open !== 'boolean') {
        errors.push(`${field}[${i}]（${p.id}）缺少布尔字段 open。`);
        continue;
      }
      out.push(
        requireOpen
          ? { id: p.id, from: p.from, to: p.to, open: p.open as boolean }
          : { id: p.id, from: p.from, to: p.to }
      );
    }
    return out;
  };

  const pipes = parsePipes(raw.pipes, 'pipes', false) as Pipe[] | null;
  const valvedPipes = parsePipes(raw.valvedPipes, 'valvedPipes', true) as ValvedPipe[] | null;

  // 阀门编号唯一性校验（阀门编号在带阀管段间必须唯一）
  if (valvedPipes) {
    const seen = new Set<string>();
    for (const vp of valvedPipes) {
      if (seen.has(vp.id)) errors.push(`阀门编号「${vp.id}」重复，阀门编号必须唯一。`);
      seen.add(vp.id);
    }
  }
  // 无管段编号也不允许（无阀管段与带阀管段之间也不允许重号，便于结果指代）
  if (pipes && valvedPipes) {
    const valvedIds = new Set(valvedPipes.map((p) => p.id));
    const pipeSeen = new Set<string>();
    for (const p of pipes) {
      if (valvedIds.has(p.id)) errors.push(`管段编号「${p.id}」同时出现在 pipes 与 valvedPipes 中。`);
      if (pipeSeen.has(p.id)) errors.push(`无阀管段编号「${p.id}」重复。`);
      pipeSeen.add(p.id);
    }
  }
  // 端点必须已声明
  if (nodes) {
    for (const p of [...(pipes ?? []), ...(valvedPipes ?? [])]) {
      if (!nodeSet.has(p.from)) errors.push(`管段「${p.id}」的起点「${p.from}」未在 nodes 中声明。`);
      if (!nodeSet.has(p.to)) errors.push(`管段「${p.id}」的终点「${p.to}」未在 nodes 中声明。`);
    }
  }

  if (errors.length > 0 || !nodes || !pipes || !valvedPipes) {
    return { errors: errors.length > 0 ? errors : ['拓扑解析失败。'] };
  }
  return { network: { nodes, pipes, valvedPipes }, errors: [] };
}

/** 校验查询条件（供水点 / 漏点 / 保供出口）。 */
export function validateQuery(network: Network, query: Query): string[] {
  const errors: string[] = [];
  const nodeSet = new Set(network.nodes);
  if (query.supplies.length === 0) errors.push('至少需要指定一个供水点。');
  for (const s of query.supplies) {
    if (!nodeSet.has(s)) errors.push(`供水点「${s}」不在节点列表中。`);
  }
  if (!query.leak) {
    errors.push('必须指定漏点。');
  } else if (!nodeSet.has(query.leak)) {
    errors.push(`漏点「${query.leak}」不在节点列表中。`);
  }
  if (query.leak && query.supplies.includes(query.leak)) {
    errors.push(`漏点「${query.leak}」不能同时是供水点。`);
  }
  for (const o of query.outlets) {
    if (!nodeSet.has(o)) errors.push(`保供出口「${o}」不在节点列表中。`);
  }
  const openCount = network.valvedPipes.filter((v) => v.open).length;
  if (openCount > MAX_OPEN_VALVES) {
    errors.push(
      `当前开启的阀门有 ${openCount} 个，超过上限 ${MAX_OPEN_VALVES} 个；` +
      '请先在输入中将部分阀门标记为关闭（"open": false）后再求解。'
    );
  }
  return errors;
}

/** 构建无向邻接表：无阀管段全部保留，带阀管段仅在开启且未被关闭时保留。 */
function buildAdjacency(network: Network, closed: Set<string>): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  const addEdge = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push(b);
  };
  for (const p of network.pipes) {
    addEdge(p.from, p.to);
    addEdge(p.to, p.from);
  }
  for (const vp of network.valvedPipes) {
    if (!vp.open || closed.has(vp.id)) continue; // 已关闭的阀门视为断开
    addEdge(vp.from, vp.to);
    addEdge(vp.to, vp.from);
  }
  return adj;
}

function bfs(adj: Map<string, string[]>, start: string): Set<string> {
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of adj.get(cur) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/** 评估某个关阀组合，返回该方案详情（不修改输入网络）。 */
export function evaluate(network: Network, query: Query, closed: string[]): Solution {
  const closedSet = new Set(closed);
  const adj = buildAdjacency(network, closedSet);
  const reachBySupply = new Map<string, Set<string>>();
  for (const s of query.supplies) {
    reachBySupply.set(s, bfs(adj, s));
  }
  const leakIsolated = query.supplies.every((s) => !reachBySupply.get(s)!.has(query.leak));
  const outletStatus: OutletStatus[] = query.outlets.map((outlet) => {
    const reachableSupplies = query.supplies.filter((s) => reachBySupply.get(s)!.has(outlet));
    return { outlet, connected: reachableSupplies.length > 0, reachableSupplies };
  });
  return { closed: [...closed].sort(), leakIsolated, outletStatus };
}

function isValid(sol: Solution): boolean {
  return sol.leakIsolated && sol.outletStatus.every((o) => o.connected);
}

/**
 * 按关阀数从小到大枚举组合；组合本身按「编号升序列表」的字典序生成，
 * 因此同一关阀数下第一个可行解即字典序最小解。
 */
export function solve(network: Network, query: Query): SolveResult {
  const queryErrors = validateQuery(network, query);
  if (queryErrors.length > 0) return { status: 'invalid', errors: queryErrors };

  const openValves = network.valvedPipes.filter((v) => v.open).map((v) => v.id).sort();
  const n = openValves.length;

  for (let k = 0; k <= n; k++) {
    const solutions: Solution[] = [];
    let truncated = false;
    // 字典序生成 k 组合
    const idx = Array.from({ length: k }, (_, i) => i);
    while (true) {
      if (k > 0) {
        const closed = idx.map((i) => openValves[i]);
        const sol = evaluate(network, query, closed);
        if (isValid(sol)) {
          if (solutions.length < MAX_SOLUTIONS) {
            solutions.push(sol);
          } else {
            truncated = true;
          }
        }
      } else {
        const sol = evaluate(network, query, []);
        if (isValid(sol)) solutions.push(sol);
      }
      if (k === 0) break;
      // 下一个组合
      let i = k - 1;
      while (i >= 0 && idx[i] === n - k + i) i--;
      if (i < 0) break;
      idx[i]++;
      for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
    }
    if (solutions.length > 0) {
      return { status: 'ok', openValveCount: n, minClosed: k, solutions, truncated };
    }
  }
  return {
    status: 'no-solution',
    openValveCount: n,
    reason:
      '在全部当前开启阀门的任意关阀组合中，均无法同时满足「漏点与所有供水点断开」且「每个保供出口仍连通至少一个供水点」。' +
      '请检查拓扑、供水点与保供出口设置，或考虑增设阀门 / 旁通管段。',
  };
}

function uniquePreservingOrder(values: string[]): string[] {
  return [...new Set(values)];
}

/** 参与韧性评估的管段：无阀管段与当前开启的带阀管段均按单条计；自环对连通无意义，忽略。 */
function collectActiveEdges(network: Network): ActiveEdge[] {
  const edges: ActiveEdge[] = [];
  for (const p of network.pipes) {
    if (p.from !== p.to) edges.push({ id: p.id, from: p.from, to: p.to });
  }
  for (const vp of network.valvedPipes) {
    if (vp.open && vp.from !== vp.to) edges.push({ id: vp.id, from: vp.from, to: vp.to });
  }
  return edges;
}

/** 仅依据当前阀门开闭状态，从全部供水点出发做连通性遍历。 */
function reachableFromSupplies(
  edges: ActiveEdge[],
  indexOf: Map<string, number>,
  supplyIdx: Set<number>
): boolean[] {
  const n = indexOf.size;
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const e of edges) {
    const u = indexOf.get(e.from)!;
    const v = indexOf.get(e.to)!;
    adj[u].push(v);
    adj[v].push(u);
  }
  const seen = new Array<boolean>(n).fill(false);
  const queue: number[] = [];
  for (const s of supplyIdx) {
    if (!seen[s]) {
      seen[s] = true;
      queue.push(s);
    }
  }
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of adj[cur]) {
      if (!seen[next]) {
        seen[next] = true;
        queue.push(next);
      }
    }
  }
  return seen;
}

/** Dinic 最大流：节点编号为 0..n-1，另有一个超级源点 n。 */
class Dinic {
  private readonly head: number[];
  private readonly next: number[] = [];
  private readonly to: number[] = [];
  private readonly cap: number[] = [];
  private readonly level: number[];
  private readonly it: number[];

  constructor(private readonly n: number) {
    this.head = new Array(n + 1).fill(-1);
    this.level = new Array(n + 1).fill(-1);
    this.it = new Array(n + 1).fill(0);
  }

  get source(): number {
    return this.n;
  }

  /** 增加一条容量为 cap 的有向弧（自动附带零容量反向弧）。 */
  addArc(u: number, v: number, cap: number): void {
    this.next.push(this.head[u]);
    this.to.push(v);
    this.cap.push(cap);
    this.head[u] = this.next.length - 1;

    this.next.push(this.head[v]);
    this.to.push(u);
    this.cap.push(0);
    this.head[v] = this.next.length - 1;
  }

  /** 无向单位容量边：两个方向各一条容量 1 的弧。 */
  addUndirectedUnit(u: number, v: number): void {
    this.addArc(u, v, 1);
    this.addArc(v, u, 1);
  }

  private bfs(s: number, t: number): boolean {
    this.level.fill(-1);
    this.level[s] = 0;
    const queue = [s];
    while (queue.length > 0) {
      const u = queue.shift()!;
      for (let a = this.head[u]; a !== -1; a = this.next[a]) {
        if (this.cap[a] > 0 && this.level[this.to[a]] === -1) {
          this.level[this.to[a]] = this.level[u] + 1;
          queue.push(this.to[a]);
        }
      }
    }
    return this.level[t] !== -1;
  }

  private dfs(u: number, t: number, pushed: number): number {
    if (u === t || pushed === 0) return pushed;
    while (this.it[u] !== -1) {
      const a = this.it[u];
      const v = this.to[a];
      if (this.cap[a] > 0 && this.level[v] === this.level[u] + 1) {
        const flow = this.dfs(v, t, Math.min(pushed, this.cap[a]));
        if (flow > 0) {
          this.cap[a] -= flow;
          this.cap[a ^ 1] += flow;
          return flow;
        }
      }
      // 该弧无法再增广，推进当前弧指针
      this.it[u] = this.next[a];
    }
    return 0;
  }

  maxFlow(s: number, t: number): number {
    let flow = 0;
    while (this.bfs(s, t)) {
      for (let i = 0; i < this.it.length; i++) this.it[i] = this.head[i];
      while (true) {
        const pushed = this.dfs(s, t, Infinity);
        if (pushed === 0) break;
        flow += pushed;
      }
    }
    return flow;
  }

  /**
   * 最大流后在残量网络上可到达汇点 t 的节点集合（沿残量弧反向 BFS）。
   * 该集合是「最靠近出口」的最小割：在所有等优割中隔离范围最小、
   * 不会为了切掉一个出口而把整个供水侧都划入割集，便于据此安排巡检。
   */
  sinkSideCut(t: number): boolean[] {
    const inSinkSide = new Array(this.n + 1).fill(false);
    inSinkSide[t] = true;
    const queue = [t];
    while (queue.length > 0) {
      const v = queue.shift()!;
      for (let a = this.head[v]; a !== -1; a = this.next[a]) {
        const u = this.to[a]; // a 为 v→u，其配对弧 a^1 为 u→v
        // u→v 仍有残量，则 u 可经 v 到达汇点
        if (this.cap[a ^ 1] > 0 && !inSinkSide[u]) {
          inSinkSide[u] = true;
          queue.push(u);
        }
      }
    }
    return inSinkSide;
  }
}

/**
 * 保供韧性巡检：对每个保供出口，计算在当前阀门开闭状态下，使其失去全部供水
 * （与所有供水点同时断开）至少需要失效多少条不同管段，并给出一组达到该数量的
 * 管段编号。无阀管段与开启的带阀管段均按单条失效计；已关阀门不参与。
 * 多个供水点作为整体（超级源点以无穷大容量接入），环路与并行管段分别计数。
 * 结果即无向多重图（单位边容）上「供水点集合 → 出口」的最小边割，由最大流求得。
 */
export function inspectResilience(network: Network, query: Query): ResilienceResult {
  const errors: string[] = [];
  const nodeSet = new Set(network.nodes);
  if (query.supplies.length === 0) errors.push('至少需要指定一个供水点。');
  for (const s of query.supplies) {
    if (!nodeSet.has(s)) errors.push(`供水点「${s}」不在节点列表中。`);
  }
  for (const o of query.outlets) {
    if (!nodeSet.has(o)) errors.push(`保供出口「${o}」不在节点列表中。`);
  }
  if (errors.length > 0) return { status: 'invalid', errors };

  const supplies = uniquePreservingOrder(query.supplies);
  const outlets = uniquePreservingOrder(query.outlets);
  const supplySet = new Set(supplies);

  const edges = collectActiveEdges(network);
  const indexOf = new Map<string, number>();
  network.nodes.forEach((node, i) => indexOf.set(node, i));
  const supplyIdx = new Set(supplies.map((s) => indexOf.get(s)!));
  const reachable = reachableFromSupplies(edges, indexOf, supplyIdx);
  // 超级源点接入管容超过任意真实边割，保证不会成为瓶颈
  const infiniteCap = edges.length + 1;

  const rows: ResilienceResultRow[] = outlets.map((outlet) => {
    if (supplySet.has(outlet)) {
      return {
        outlet,
        assessable: false,
        reason: '出口与供水点同名，无法按管段失效评估。',
      };
    }
    const t = indexOf.get(outlet)!;
    if (!reachable[t]) {
      // 当前阀门开闭状态下已无任何供水点可达：无需失效任何管段
      return { outlet, assessable: true, minFailures: 0, alreadyCut: true, witnessPipes: [] };
    }

    const dinic = new Dinic(network.nodes.length);
    for (const s of supplyIdx) dinic.addArc(dinic.source, s, infiniteCap);
    for (const e of edges) {
      dinic.addUndirectedUnit(indexOf.get(e.from)!, indexOf.get(e.to)!);
    }
    const minFailures = dinic.maxFlow(dinic.source, t);
    const inSinkSide = dinic.sinkSideCut(t);

    // 跨越割线、与出口同侧的边界管段，即一组达到最小失效数的管段（最贴近出口的割）
    const witnessPipes: string[] = [];
    for (const e of edges) {
      const u = indexOf.get(e.from)!;
      const v = indexOf.get(e.to)!;
      if (inSinkSide[u] !== inSinkSide[v]) witnessPipes.push(e.id);
    }
    witnessPipes.sort();
    return { outlet, assessable: true, minFailures, alreadyCut: false, witnessPipes };
  });

  rows.sort((a, b) => {
    if (a.assessable !== b.assessable) return a.assessable ? -1 : 1;
    if (a.assessable && b.assessable && a.minFailures !== b.minFailures) {
      return a.minFailures - b.minFailures;
    }
    return a.outlet.localeCompare(b.outlet, 'zh-Hans-CN');
  });

  return { status: 'ok', activePipeCount: edges.length, rows };
}

/**
 * 带「双向合计容量」无向边的 Dinic。
 *
 * 与韧性巡检使用的 addUndirectedUnit（两个方向各放一条独立容量弧，
 * 两方向可同时各占 1）不同，这里的无向管段在两个方向上**共享同一份容量**：
 * 正/反弧初始容量均为 1，且增广推流后两弧容量之和恒为 1，
 * 因此同一无向管段在任意流分配中双向合计至多占用一次（净流量绝对值 ≤ 1）。
 */
class CapacityDinic {
  private readonly head: number[];
  private readonly next: number[] = [];
  private readonly from: number[] = [];
  private readonly to: number[] = [];
  private readonly cap: number[] = [];
  private readonly initialCap: number[] = [];
  private readonly level: number[];
  private readonly it: number[];

  constructor(private readonly n: number) {
    this.head = new Array(n + 2).fill(-1);
    this.level = new Array(n + 2).fill(-1);
    this.it = new Array(n + 2).fill(0);
  }

  get source(): number {
    return this.n;
  }

  get sink(): number {
    return this.n + 1;
  }

  /** 增加一条有向弧（自动附带零容量反向弧），返回正向弧下标。 */
  addArc(u: number, v: number, cap: number): number {
    this.next.push(this.head[u]);
    this.from.push(u);
    this.to.push(v);
    this.cap.push(cap);
    this.initialCap.push(cap);
    this.head[u] = this.next.length - 1;
    const fwd = this.next.length - 1;

    this.next.push(this.head[v]);
    this.from.push(v);
    this.to.push(u);
    this.cap.push(0);
    this.initialCap.push(0);
    this.head[v] = this.next.length - 1;
    return fwd;
  }

  /**
   * 无向共享容量边：两弧初始容量均为 cap，配对弧更新只做净流量记账，
   * 全程保持 cap[a] + cap[a^1] === cap，双向合计占用不超过 cap（管段为 1）。
   * 返回正向弧（u→v）的下标，供割判定与流量读取使用。
   */
  addUndirectedShared(u: number, v: number, cap: number): number {
    this.next.push(this.head[u]);
    this.from.push(u);
    this.to.push(v);
    this.cap.push(cap);
    this.initialCap.push(cap);
    this.head[u] = this.next.length - 1;
    const fwd = this.next.length - 1;

    this.next.push(this.head[v]);
    this.from.push(v);
    this.to.push(u);
    this.cap.push(cap);
    this.initialCap.push(cap);
    this.head[v] = this.next.length - 1;
    return fwd;
  }

  /** 弧 a 起点。 */
  arcFrom(a: number): number {
    return this.from[a];
  }

  /** 弧 a 终点。 */
  arcTo(a: number): number {
    return this.to[a];
  }

  /** 弧 a 的剩余容量。 */
  residualCap(a: number): number {
    return this.cap[a];
  }

  /** 弧 a 的初始容量。 */
  initialArcCap(a: number): number {
    return this.initialCap[a];
  }

  /** 弧 a 已承载的流量（初始容量 - 剩余容量；共享无向边反向弧可能为负，表示反向净流）。 */
  arcFlow(a: number): number {
    return this.initialCap[a] - this.cap[a];
  }

  private bfs(s: number, t: number): boolean {
    this.level.fill(-1);
    this.level[s] = 0;
    const queue = [s];
    while (queue.length > 0) {
      const u = queue.shift()!;
      for (let a = this.head[u]; a !== -1; a = this.next[a]) {
        if (this.cap[a] > 0 && this.level[this.to[a]] === -1) {
          this.level[this.to[a]] = this.level[u] + 1;
          queue.push(this.to[a]);
        }
      }
    }
    return this.level[t] !== -1;
  }

  private dfs(u: number, t: number, pushed: number): number {
    if (u === t || pushed === 0) return pushed;
    while (this.it[u] !== -1) {
      const a = this.it[u];
      const v = this.to[a];
      if (this.cap[a] > 0 && this.level[v] === this.level[u] + 1) {
        const flow = this.dfs(v, t, Math.min(pushed, this.cap[a]));
        if (flow > 0) {
          this.cap[a] -= flow;
          this.cap[a ^ 1] += flow;
          return flow;
        }
      }
      this.it[u] = this.next[a];
    }
    return 0;
  }

  maxFlow(s: number, t: number): number {
    let flow = 0;
    while (this.bfs(s, t)) {
      for (let i = 0; i < this.it.length; i++) this.it[i] = this.head[i];
      while (true) {
        const pushed = this.dfs(s, t, Infinity);
        if (pushed === 0) break;
        flow += pushed;
      }
    }
    return flow;
  }

  /** 最大流后源侧可达节点集合（残量网络 BFS），即标准 s-t 最小割的源侧。 */
  sourceSideCut(s: number): boolean[] {
    const inSourceSide = new Array(this.n + 2).fill(false);
    inSourceSide[s] = true;
    const queue = [s];
    while (queue.length > 0) {
      const u = queue.shift()!;
      for (let a = this.head[u]; a !== -1; a = this.next[a]) {
        const v = this.to[a];
        if (this.cap[a] > 0 && !inSourceSide[v]) {
          inSourceSide[v] = true;
          queue.push(v);
        }
      }
    }
    return inSourceSide;
  }
}

/** 非负整数校验：必须为整数且 ≥ 0；拒绝 1.5、-1、NaN、Infinity。 */
function readNonNegativeInt(value: unknown): { ok: true; n: number } | { ok: false } {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return { ok: false };
  }
  return { ok: true, n: value };
}

interface ValidatedCapacityQuery {
  supplyCapList: { supply: string; cap: number }[];
  demandList: { outlet: string; demand: number }[];
}

/**
 * 供水能力类查询（核验与增容建议共用）的校验：节点存在性、
 * 供给上限与需求量必须为非负整数。
 * 返回按输入顺序去重后的上限 / 需求清单；有错误时 valid 缺省。
 */
function validateCapacityQuery(
  network: Network,
  query: CapacityQuery
): { valid?: ValidatedCapacityQuery; errors: string[] } {
  const errors: string[] = [];
  const nodeSet = new Set(network.nodes);

  if (query.supplies.length === 0) errors.push('至少需要指定一个供水点。');
  for (const s of query.supplies) {
    if (!nodeSet.has(s)) errors.push(`供水点「${s}」不在节点列表中。`);
  }
  if (query.outlets.length === 0) errors.push('至少需要指定一个保供出口。');
  for (const o of query.outlets) {
    if (!nodeSet.has(o)) errors.push(`保供出口「${o}」不在节点列表中。`);
  }

  const supplies = uniquePreservingOrder(query.supplies);
  const outlets = uniquePreservingOrder(query.outlets);

  const supplyCapList: { supply: string; cap: number }[] = [];
  for (const s of supplies) {
    if (!nodeSet.has(s)) continue;
    const raw = hasOwnKey(query.supplyCaps, s) ? query.supplyCaps[s] : undefined;
    if (raw === undefined) {
      errors.push(`供水点「${s}」缺少供给上限，请填写非负整数。`);
      continue;
    }
    const parsed = readNonNegativeInt(raw);
    if (!parsed.ok) {
      errors.push(`供水点「${s}」的供给上限必须是非负整数（收到：${String(raw)}）。`);
      continue;
    }
    supplyCapList.push({ supply: s, cap: parsed.n });
  }

  const demandList: { outlet: string; demand: number }[] = [];
  for (const o of outlets) {
    if (!nodeSet.has(o)) continue;
    const raw = hasOwnKey(query.outletDemands, o) ? query.outletDemands[o] : undefined;
    if (raw === undefined) {
      errors.push(`保供出口「${o}」缺少需求量，请填写非负整数。`);
      continue;
    }
    const parsed = readNonNegativeInt(raw);
    if (!parsed.ok) {
      errors.push(`保供出口「${o}」的需求量必须是非负整数（收到：${String(raw)}）。`);
      continue;
    }
    demandList.push({ outlet: o, demand: parsed.n });
  }

  if (errors.length > 0) return { errors };
  return { valid: { supplyCapList, demandList }, errors: [] };
}

/**
 * 在给定管段容量下计算总获配量（单源单汇最大流）。
 * 与 verifyCapacity 使用完全相同的建模（无向管段双向共享容量、
 * 源点弧为供给上限、汇点弧为出口需求），仅取最大流值，供增容枚举反复调用。
 * 纯函数，不修改输入。
 */
function computeTotalAllocated(
  network: Network,
  supplyCapList: { supply: string; cap: number }[],
  demandList: { outlet: string; demand: number }[],
  edges: ActiveEdge[],
  pipeCapacity: (edge: ActiveEdge) => number
): number {
  const indexOf = new Map<string, number>();
  network.nodes.forEach((node, i) => indexOf.set(node, i));

  const dinic = new CapacityDinic(network.nodes.length);
  const S = dinic.source;
  const T = dinic.sink;

  for (const { supply, cap } of supplyCapList) {
    dinic.addArc(S, indexOf.get(supply)!, cap);
  }
  for (const e of edges) {
    const u = indexOf.get(e.from)!;
    const v = indexOf.get(e.to)!;
    dinic.addUndirectedShared(u, v, pipeCapacity(e));
  }
  for (const { outlet, demand } of demandList) {
    dinic.addArc(indexOf.get(outlet)!, T, demand);
  }

  return dinic.maxFlow(S, T);
}

/**
 * 供水能力核验：在当前阀门开闭状态下，按各供水点供给上限、各保供出口需求量，
 * 求「总供给最大分配」（单源单汇最大流），给出每个出口的获配量与缺口，
 * 并给出一组限制总供给的最小割项目（供给上限 / 连通管段 / 出口需求）。
 *
 * 建模：
 * - 超级源点 → 供水点：容量为该供水点的供给上限；
 * - 每条无阀管段与当前开启的带阀管段：双向共享容量 1 的无向边，
 *   同一管段双向合计只能占用一次，已关阀不参与；
 * - 出口 → 超级汇点：容量为该出口的需求量。
 * 多供水点上限与多出口需求经最大流同时约束。最小割中饱和跨越的弧即瓶颈项目。
 * 纯函数，不修改输入。
 */
export function verifyCapacity(network: Network, query: CapacityQuery): CapacityResult {
  const { valid, errors } = validateCapacityQuery(network, query);
  if (!valid) return { status: 'invalid', errors };
  const { supplyCapList, demandList } = valid;

  const edges = collectActiveEdges(network);
  const indexOf = new Map<string, number>();
  network.nodes.forEach((node, i) => indexOf.set(node, i));

  const dinic = new CapacityDinic(network.nodes.length);
  const S = dinic.source;
  const T = dinic.sink;

  // 记录每条瓶颈候选弧，供最小割项目归集
  const supplyArcIndex = new Map<number, { supply: string; cap: number }>();
  for (const { supply, cap } of supplyCapList) {
    const u = indexOf.get(supply)!;
    const arc = dinic.addArc(S, u, cap);
    supplyArcIndex.set(arc, { supply, cap });
  }

  interface PipeArc {
    id: string;
    fwdArc: number;
  }
  const pipeArcs: PipeArc[] = [];
  for (const e of edges) {
    const u = indexOf.get(e.from)!;
    const v = indexOf.get(e.to)!;
    const fwdArc = dinic.addUndirectedShared(u, v, 1);
    pipeArcs.push({ id: e.id, fwdArc });
  }

  const demandArcIndex = new Map<number, { outlet: string; demand: number }>();
  for (const { outlet, demand } of demandList) {
    const v = indexOf.get(outlet)!;
    const arc = dinic.addArc(v, T, demand);
    demandArcIndex.set(arc, { outlet, demand });
  }

  const totalAllocated = dinic.maxFlow(S, T);
  const inSourceSide = dinic.sourceSideCut(S);

  // 各供水点实际供出量 = 其源点弧上的流量
  const supplyRows: CapacitySupplyRow[] = supplyCapList.map(({ supply, cap }) => {
    let used = 0;
    for (const [arc, info] of supplyArcIndex) {
      if (info.supply === supply) used += dinic.arcFlow(arc);
    }
    return { supply, cap, used };
  });

  // 各出口获配量 = 其汇点弧上的流量
  const outletFlow = new Map<string, number>();
  for (const [arc, info] of demandArcIndex) {
    outletFlow.set(info.outlet, dinic.arcFlow(arc));
  }

  const rows: CapacityOutletRow[] = demandList.map(({ outlet, demand }) => {
    const allocated = outletFlow.get(outlet) ?? 0;
    return {
      outlet,
      demand,
      allocated,
      shortfall: demand - allocated,
      fullySupplied: allocated >= demand,
    };
  });

  // 最小割项目：饱和跨越源侧→汇侧的弧（容量为 0 的弧恒饱和但不构成实际限制，排除）
  const isCrossing = (arc: number): boolean =>
    inSourceSide[dinic.arcFrom(arc)] &&
    !inSourceSide[dinic.arcTo(arc)] &&
    dinic.residualCap(arc) === 0 &&
    dinic.initialArcCap(arc) > 0;

  const cutItems: CapacityCutItem[] = [];
  for (const [arc, info] of supplyArcIndex) {
    if (isCrossing(arc)) {
      cutItems.push({ kind: 'supply', id: info.supply, capacity: info.cap });
    }
  }
  for (const pa of pipeArcs) {
    // 无向共享边：任一方向弧饱和跨越割线即该管段受限（两弧至多一条满足）
    if (isCrossing(pa.fwdArc) || isCrossing(pa.fwdArc ^ 1)) {
      cutItems.push({ kind: 'pipe', id: pa.id, capacity: 1 });
    }
  }
  for (const [arc, info] of demandArcIndex) {
    if (isCrossing(arc)) {
      cutItems.push({ kind: 'demand', id: info.outlet, capacity: info.demand });
    }
  }
  // 排序：类型固定顺序（供给→管段→需求），同类按名称/编号，便于阅读与对照
  const kindOrder: Record<CapacityCutKind, number> = { supply: 0, pipe: 1, demand: 2 };
  cutItems.sort((a, b) => {
    if (kindOrder[a.kind] !== kindOrder[b.kind]) return kindOrder[a.kind] - kindOrder[b.kind];
    return a.id.localeCompare(b.id, 'zh-Hans-CN');
  });

  const totalSupplyCap = supplyCapList.reduce((sum, x) => sum + x.cap, 0);
  const totalDemand = demandList.reduce((sum, x) => sum + x.demand, 0);
  const cutCapacity = cutItems.reduce((sum, x) => sum + x.capacity, 0);

  return {
    status: 'ok',
    activePipeCount: edges.length,
    totalSupplyCap,
    totalDemand,
    totalAllocated,
    totalShortfall: totalDemand - totalAllocated,
    supplyRows,
    rows,
    cutItems,
    cutCapacity,
  };
}

/**
 * 重点出口优先配水：沿用供水能力核验的全部建模（当前阀门状态、供给上限、出口需求、
 * 无向管段双向共享容量 1），做两级字典序最大化：
 *   1. 先使「重点出口」总获配量最大；
 *   2. 再在不减少该值的前提下，使全部出口总获配量最大。
 *
 * 实现为同一网络上的两阶段连续增广：
 * - 第一阶段：网络中只挂「重点出口 → 汇点」的需求弧（普通出口不接汇点），
 *   求一次最大流，其值即重点出口能拿到的最大总量；
 * - 第二阶段：在第一阶段的残量网络上补挂「普通出口 → 汇点」需求弧，再求一次
 *   最大流继续增广。残量网络保留了第一阶段全部已分配流量及其反向回退弧，
 *   因此第二阶段的增广路可以穿过重点出口附近的反向弧、把第一阶段占用的管段
 *   「改派」给其他路径（即允许重新调度已有流量），避免逐出口贪心占管造成的
 *   虚假缺口。增广路始终终于某条出口汇点弧，且第二阶段不存在从源点经重点出口
 *   汇点弧到达汇点的增广路（否则与第一阶段已达重点最大流矛盾），故重点出口
 *   各汇点弧上的流量在第二阶段保持不变，第一级目标值必然不减少。
 * 当没有任何重点出口时，第一阶段值为 0，第二阶段即普通核验的最大流，
 * 总获配量与 verifyCapacity 完全一致。纯函数，不修改输入。
 */
export function verifyPriorityCapacity(network: Network, query: CapacityQuery): PriorityCapacityResult {
  const { valid, errors } = validateCapacityQuery(network, query);
  if (!valid) return { status: 'invalid', errors };
  const { supplyCapList, demandList } = valid;

  // 重点出口名单校验：必须是字符串数组，且每个重点出口都在保供出口名单内
  const priorityErrors: string[] = [];
  const rawPriority = query.priorityOutlets;
  if (rawPriority !== undefined && !asStringArray(rawPriority)) {
    priorityErrors.push('重点出口名单必须是字符串数组。');
  }
  const outletSet = new Set(demandList.map((d) => d.outlet));
  const priorityOutlets: string[] = [];
  if (Array.isArray(rawPriority)) {
    for (const o of uniquePreservingOrder(rawPriority)) {
      if (!outletSet.has(o)) {
        priorityErrors.push(`重点出口「${o}」不在保供出口名单中，请先在保供出口中填写并勾选重点。`);
      } else {
        priorityOutlets.push(o);
      }
    }
  }
  if (priorityErrors.length > 0) return { status: 'invalid', errors: priorityErrors };

  const prioritySet = new Set(priorityOutlets);

  const edges = collectActiveEdges(network);
  const indexOf = new Map<string, number>();
  network.nodes.forEach((node, i) => indexOf.set(node, i));

  const dinic = new CapacityDinic(network.nodes.length);
  const S = dinic.source;
  const T = dinic.sink;

  for (const { supply, cap } of supplyCapList) {
    dinic.addArc(S, indexOf.get(supply)!, cap);
  }
  for (const e of edges) {
    const u = indexOf.get(e.from)!;
    const v = indexOf.get(e.to)!;
    dinic.addUndirectedShared(u, v, 1);
  }

  // 第一阶段：只挂重点出口汇点弧，使重点总获配最大
  const priorityArcIndex = new Map<number, string>();
  for (const { outlet, demand } of demandList) {
    if (!prioritySet.has(outlet)) continue;
    const arc = dinic.addArc(indexOf.get(outlet)!, T, demand);
    priorityArcIndex.set(arc, outlet);
  }
  const priorityAllocated = dinic.maxFlow(S, T);

  // 第二阶段：在同一残量网络上补挂普通出口汇点弧继续增广（允许改派第一阶段流量）
  const normalArcIndex = new Map<number, string>();
  for (const { outlet, demand } of demandList) {
    if (prioritySet.has(outlet)) continue;
    const arc = dinic.addArc(indexOf.get(outlet)!, T, demand);
    normalArcIndex.set(arc, outlet);
  }
  const secondStageGain = dinic.maxFlow(S, T);
  const totalAllocated = priorityAllocated + secondStageGain;

  const allocatedByOutlet = new Map<string, number>();
  for (const [arc, outlet] of priorityArcIndex) {
    allocatedByOutlet.set(outlet, dinic.arcFlow(arc));
  }
  for (const [arc, outlet] of normalArcIndex) {
    allocatedByOutlet.set(outlet, dinic.arcFlow(arc));
  }

  const rows: PriorityCapacityOutletRow[] = demandList.map(({ outlet, demand }) => {
    const allocated = allocatedByOutlet.get(outlet) ?? 0;
    return {
      outlet,
      category: prioritySet.has(outlet) ? 'priority' : 'normal',
      demand,
      allocated,
      shortfall: demand - allocated,
      fullySupplied: allocated >= demand,
    };
  });

  const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
  const totalSupplyCap = sum(supplyCapList.map((x) => x.cap));
  const totalDemand = sum(demandList.map((x) => x.demand));
  const priorityDemand = sum(demandList.filter((d) => prioritySet.has(d.outlet)).map((d) => d.demand));
  const normalAllocated = sum(
    rows.filter((r) => r.category === 'normal').map((r) => r.allocated)
  );

  return {
    status: 'ok',
    activePipeCount: edges.length,
    priorityOutletCount: priorityOutlets.length,
    totalSupplyCap,
    totalDemand,
    priorityAllocated,
    priorityDemand,
    priorityShortfall: priorityDemand - priorityAllocated,
    totalAllocated,
    normalAllocated,
    totalShortfall: totalDemand - totalAllocated,
    rows,
  };
}

/** 增容方案取舍：总获配量最高 → 改造条数最少 → 管段编号（升序）列表字典序最小。 */
function compareExpansionPlans(a: ExpansionPlan, b: ExpansionPlan): number {  if (a.totalAllocated !== b.totalAllocated) return b.totalAllocated - a.totalAllocated;
  if (a.upgraded.length !== b.upgraded.length) return a.upgraded.length - b.upgraded.length;
  for (let i = 0; i < a.upgraded.length; i++) {
    if (a.upgraded[i] !== b.upgraded[i]) return a.upgraded[i] < b.upgraded[i] ? -1 : 1;
  }
  return 0;
}

/**
 * 管段增容建议：沿用供水能力核验的拓扑、供给上限与出口需求，在当前阀门开闭
 * 状态下，枚举「不改造 / 改造单条 / 改造两条」三种情形——将候选管段容量各由 1
 * 提至 2（最多两条），分别计算总获配量，找出最值得实施的增容方案。
 *
 * - 候选管段为参与输水的不同管段（无阀管段 + 当前开启的带阀管段）；
 *   已关阀与自环不参与输水，自然不可选；
 * - 两条组合与单条、基线一并比较，因此「单条无收益、两条一起才有收益」
 *   （如两条串联瓶颈管段）的情形会被正确识别；
 * - 推荐取舍：总获配量最高 → 改造条数最少 → 管段编号（升序）列表字典序最小；
 *   任何改造都无增益时推荐「不改造」（增量为 0）；
 * - 纯函数，不修改输入拓扑与数值，也不影响供水能力核验的结果。
 */
export function suggestExpansion(network: Network, query: CapacityQuery): ExpansionResult {
  const { valid, errors } = validateCapacityQuery(network, query);
  if (!valid) return { status: 'invalid', errors };
  const { supplyCapList, demandList } = valid;

  // 候选管段：参与输水的不同管段（无阀管段 + 当前开启的带阀管段）；已关阀与自环不可选
  const edges = collectActiveEdges(network);
  const candidateIds = [...new Set(edges.map((e) => e.id))].sort();

  const allocatedWith = (upgraded: ReadonlySet<string>): number =>
    computeTotalAllocated(network, supplyCapList, demandList, edges, (e) =>
      upgraded.has(e.id) ? EXPANSION_TARGET_CAPACITY : 1
    );

  const baseline = allocatedWith(new Set());
  const planOf = (upgraded: string[]): ExpansionPlan => {
    const totalAllocated = allocatedWith(new Set(upgraded));
    return { upgraded, totalAllocated, gain: totalAllocated - baseline };
  };

  // 不改造即初始推荐；任何改造方案只有严格更优（按取舍规则）才会替换它
  let recommended: ExpansionPlan = { upgraded: [], totalAllocated: baseline, gain: 0 };
  let bestSingle: ExpansionPlan | null = null;
  let bestPair: ExpansionPlan | null = null;

  for (const id of candidateIds) {
    const plan = planOf([id]);
    if (!bestSingle || compareExpansionPlans(plan, bestSingle) < 0) bestSingle = plan;
    if (compareExpansionPlans(plan, recommended) < 0) recommended = plan;
  }
  for (let i = 0; i < candidateIds.length; i++) {
    for (let j = i + 1; j < candidateIds.length; j++) {
      const plan = planOf([candidateIds[i], candidateIds[j]]);
      if (!bestPair || compareExpansionPlans(plan, bestPair) < 0) bestPair = plan;
      if (compareExpansionPlans(plan, recommended) < 0) recommended = plan;
    }
  }

  return {
    status: 'ok',
    activePipeCount: candidateIds.length,
    baseline,
    recommended,
    bestSingle,
    bestPair,
  };
}

// ============ 双阀意外关闭风险扫描 ============

/** 双阀风险扫描参与枚举的当前开启阀门数量上限 */
export const MAX_RISK_OPEN_VALVES = 20;

/** 一个单阀 / 两阀意外关闭场景的测算结果。 */
export interface ValveRiskScenario {
  /** 场景类型：单阀意外关闭 / 两阀意外关闭 */
  kind: 'single' | 'pair';
  /** 被意外关闭的阀门编号（升序；单阀时仅 1 个） */
  closedValves: string[];
  /** 该场景下按现有无向管段共享容量模型重算的总获配量 */
  totalAllocated: number;
  /** 新增缺口 = 基线总获配 - 该场景总获配（恒为正，仅列出有新增缺口的场景） */
  addedShortfall: number;
  /**
   * 两阀场景：新增缺口是否严格大于两个对应单阀新增缺口之和（协同失供）；
   * 单阀场景恒为 false。
   */
  synergistic: boolean;
}

export interface ValveRiskOk {
  status: 'ok';
  /** 参与扫描的当前开启阀门数 */
  openValveCount: number;
  /** 参与输水的管段总数（无阀管段 + 当前开启的带阀管段；自环不计） */
  activePipeCount: number;
  /** 不模拟任何意外关闭时的总获配量（基线） */
  baselineAllocated: number;
  /** 模拟场景总数 = 单阀 n 个 + 两阀 C(n,2) 个 */
  scenarioCount: number;
  /**
   * 全部有新增缺口的场景：按新增缺口降序，同缺口按阀门编号列表字典序。
   * 无任何有新增缺口的场景时为空清单。
   */
  lossScenarios: ValveRiskScenario[];
}

export interface ValveRiskInvalid {
  status: 'invalid';
  errors: string[];
}

export type ValveRiskResult = ValveRiskOk | ValveRiskInvalid;

/** 阀门编号（升序）列表的字典序比较：逐编号比较，前缀较短者优先。 */
function compareValveLists(a: readonly string[], b: readonly string[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return a.length - b.length;
}

/**
 * 双阀意外关闭风险扫描：沿用现有拓扑、阀门登记状态与供水能力填写表，
 * 不改登记状态，仅对**当前开启**的阀门（最多 MAX_RISK_OPEN_VALVES 个）
 * 模拟「单个阀门意外关闭」与「两个阀门同时意外关闭」场景。
 *
 * - 基线与每个场景均按现有供水能力核验模型重算最大获配：无阀管段与当前开启的
 *   带阀管段为双向共享容量 1 的无向边；被模拟关闭的阀门对应管段从场景中移除，
 *   已关阀与自环本就不参与输水；
 * - 以「场景总获配相对基线减少的数值」为**新增缺口**，仅列出新增缺口 > 0 的
 *   场景，按新增缺口降序、阀门编号（升序）列表字典序展示全部有损场景；
 * - 两阀场景的新增缺口**严格大于**两个对应单阀新增缺口之和时标为**协同失供**
 *   （两阀同时关闭的额外损失超出各自单独关闭的损失之和）；
 * - 无任何有损场景时返回空清单，由页面明确提示。
 * 纯函数，不修改输入拓扑、登记的阀门状态与数值表。
 */
export function scanValveClosureRisk(network: Network, query: CapacityQuery): ValveRiskResult {
  const { valid, errors } = validateCapacityQuery(network, query);
  if (!valid) return { status: 'invalid', errors };
  const { supplyCapList, demandList } = valid;

  const openValves = network.valvedPipes.filter((v) => v.open).map((v) => v.id).sort();
  if (openValves.length > MAX_RISK_OPEN_VALVES) {
    return {
      status: 'invalid',
      errors: [
        `当前开启的阀门有 ${openValves.length} 个，超过风险扫描上限 ${MAX_RISK_OPEN_VALVES} 个；` +
        '请先在输入中将部分阀门标记为关闭（"open": false）后再扫描。',
      ],
    };
  }

  const baseEdges = collectActiveEdges(network);

  /** 在模拟关闭指定开启阀门后的管段集合上重算总获配（不改动登记状态）。 */
  const allocatedWithClosed = (closed: ReadonlySet<string>): number => {
    const edges = closed.size === 0 ? baseEdges : baseEdges.filter((e) => !closed.has(e.id));
    return computeTotalAllocated(network, supplyCapList, demandList, edges, () => 1);
  };

  const baselineAllocated = allocatedWithClosed(new Set());

  // 单阀场景：编号升序计算，同时保存各单阀新增缺口供协同判定
  const singleShortfall = new Map<string, number>();
  for (const id of openValves) {
    const allocated = allocatedWithClosed(new Set([id]));
    singleShortfall.set(id, baselineAllocated - allocated);
  }

  // 两阀场景：仅当存在新增缺口时才保留；协同判定在汇总排序前完成
  const pairScenarios: ValveRiskScenario[] = [];
  for (let i = 0; i < openValves.length; i++) {
    for (let j = i + 1; j < openValves.length; j++) {
      const a = openValves[i];
      const b = openValves[j];
      const allocated = allocatedWithClosed(new Set([a, b]));
      const addedShortfall = baselineAllocated - allocated;
      if (addedShortfall <= 0) continue;
      pairScenarios.push({
        kind: 'pair',
        closedValves: [a, b],
        totalAllocated: allocated,
        addedShortfall,
        synergistic: addedShortfall > (singleShortfall.get(a)! + singleShortfall.get(b)!),
      });
    }
  }

  const singleScenarios: ValveRiskScenario[] = openValves
    .map((id) => ({
      kind: 'single' as const,
      closedValves: [id],
      totalAllocated: baselineAllocated - singleShortfall.get(id)!,
      addedShortfall: singleShortfall.get(id)!,
      synergistic: false,
    }))
    .filter((s) => s.addedShortfall > 0);

  const lossScenarios = [...singleScenarios, ...pairScenarios].sort((a, b) => {
    if (a.addedShortfall !== b.addedShortfall) return b.addedShortfall - a.addedShortfall;
    return compareValveLists(a.closedValves, b.closedValves);
  });

  const n = openValves.length;
  return {
    status: 'ok',
    openValveCount: n,
    activePipeCount: baseEdges.length,
    baselineAllocated,
    scenarioCount: n + (n * (n - 1)) / 2,
    lossScenarios,
  };
}

// ============ 阀门状态异常定位 ============

/** 异常定位最多枚举的阀门状态翻转处数 */
export const MAX_FLIPS = 2;

export interface AnomalyQuery {
  /** 供水点节点 */
  supplies: string[];
  /** 现场观测有水的节点 */
  wetNodes: string[];
  /** 现场观测无水的节点 */
  dryNodes: string[];
}

/** 一个匹配方案中某阀门的开闭状态对照。 */
export interface ValveStateRow {
  /** 阀门编号（带阀管段 id） */
  id: string;
  /** 登记（基线）开闭状态 */
  registeredOpen: boolean;
  /** 翻转后的实际开闭状态（未翻转时与登记一致） */
  actualOpen: boolean;
  /** 该阀门是否被翻转 */
  flipped: boolean;
}

export interface AnomalySolution {
  /** 被翻转的阀门编号（升序）；空数组表示零翻转（登记状态一致） */
  flipped: string[];
  /** 翻转后全部阀门的开闭状态对照（按阀门编号升序） */
  valveStates: ValveStateRow[];
}

export interface AnomalyOk {
  status: 'ok';
  /** 参与枚举的阀门总数（全部带阀管段，开、关状态均可翻转） */
  valveCount: number;
  /** 匹配所需的最少翻转处数（0 表示登记状态与观测一致） */
  minFlips: number;
  /** 翻转数最少的全部匹配方案，按阀门编号升序列表字典序排列 */
  solutions: AnomalySolution[];
  /** 最优方案总数超过展示上限时为 true */
  truncated: boolean;
}

export interface AnomalyNoMatch {
  status: 'no-match';
  valveCount: number;
  reason: string;
}

export interface AnomalyInvalid {
  status: 'invalid';
  errors: string[];
}

export type AnomalyResult = AnomalyOk | AnomalyNoMatch | AnomalyInvalid;

/**
 * 阀门状态异常定位：以登记的各带阀管段开闭状态为基线，枚举最多 MAX_FLIPS 处
 * 状态翻转（开→关或关→开，已关阀也可被翻为开），找出能同时解释全部现场观测的候选。
 *
 * 每个候选按「无阀管段 + 实际开启的带阀管段」计算节点对任一供水点的可达性：
 * 有水观测节点必须可达、无水观测节点必须不可达；只用已观测节点判定匹配，
 * 未观测节点的通水状态不参与判定。
 * 按翻转数 0、1、2 依次枚举，找到匹配即停止，保证翻转数最少；
 * 同一翻转数下组合按阀门编号升序列表字典序生成。纯函数，不修改输入。
 */
export function locateValveAnomalies(network: Network, query: AnomalyQuery): AnomalyResult {
  const errors: string[] = [];
  const nodeSet = new Set(network.nodes);
  if (query.supplies.length === 0) errors.push('至少需要指定一个供水点。');
  for (const s of query.supplies) {
    if (!nodeSet.has(s)) errors.push(`供水点「${s}」不在节点列表中。`);
  }
  const supplies = uniquePreservingOrder(query.supplies);
  const wetNodes = uniquePreservingOrder(query.wetNodes);
  const dryNodes = uniquePreservingOrder(query.dryNodes);
  for (const w of wetNodes) {
    if (!nodeSet.has(w)) errors.push(`有水观测节点「${w}」不在节点列表中。`);
  }
  for (const d of dryNodes) {
    if (!nodeSet.has(d)) errors.push(`无水观测节点「${d}」不在节点列表中。`);
  }
  if (wetNodes.length === 0 && dryNodes.length === 0) {
    errors.push('请至少填写一个现场观测节点（有水或无水）。');
  }
  const drySet = new Set(dryNodes);
  for (const w of wetNodes) {
    if (drySet.has(w)) errors.push(`节点「${w}」同时出现在有水与无水观测中，两组观测冲突。`);
  }
  const supplySet = new Set(supplies);
  for (const d of dryNodes) {
    if (supplySet.has(d)) errors.push(`供水点「${d}」本身恒有水，不能登记为无水观测。`);
  }
  if (errors.length > 0) return { status: 'invalid', errors };

  // 候选翻转集合下的通水节点集合：无阀管段全部保留，
  // 带阀管段按「登记状态 XOR 被翻转」得到的实际开闭状态保留
  const reachableWithFlips = (flipped: ReadonlySet<string>): Set<string> => {
    const adj = new Map<string, string[]>();
    const addEdge = (a: string, b: string) => {
      if (!adj.has(a)) adj.set(a, []);
      adj.get(a)!.push(b);
    };
    for (const p of network.pipes) {
      addEdge(p.from, p.to);
      addEdge(p.to, p.from);
    }
    for (const vp of network.valvedPipes) {
      const actualOpen = flipped.has(vp.id) ? !vp.open : vp.open;
      if (!actualOpen) continue;
      addEdge(vp.from, vp.to);
      addEdge(vp.to, vp.from);
    }
    const seen = new Set<string>(supplies);
    const queue = [...supplies];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const next of adj.get(cur) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return seen;
  };

  const matches = (flipped: ReadonlySet<string>): boolean => {
    const reachable = reachableWithFlips(flipped);
    return wetNodes.every((n) => reachable.has(n)) && dryNodes.every((n) => !reachable.has(n));
  };

  const makeSolution = (flipped: string[]): AnomalySolution => {
    const flippedSet = new Set(flipped);
    const valveStates: ValveStateRow[] = network.valvedPipes
      .map((vp) => ({
        id: vp.id,
        registeredOpen: vp.open,
        actualOpen: flippedSet.has(vp.id) ? !vp.open : vp.open,
        flipped: flippedSet.has(vp.id),
      }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { flipped: [...flipped].sort(), valveStates };
  };

  const valveIds = network.valvedPipes.map((v) => v.id).sort();
  const n = valveIds.length;

  for (let k = 0; k <= Math.min(MAX_FLIPS, n); k++) {
    const solutions: AnomalySolution[] = [];
    let truncated = false;
    // 字典序生成 k 组合（与关阀方案搜索同一枚举顺序）
    const idx = Array.from({ length: k }, (_, i) => i);
    while (true) {
      const flipped = idx.map((i) => valveIds[i]);
      if (matches(new Set(flipped))) {
        if (solutions.length < MAX_SOLUTIONS) {
          solutions.push(makeSolution(flipped));
        } else {
          truncated = true;
        }
      }
      if (k === 0) break;
      // 下一个组合
      let i = k - 1;
      while (i >= 0 && idx[i] === n - k + i) i--;
      if (i < 0) break;
      idx[i]++;
      for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
    }
    if (solutions.length > 0) {
      return { status: 'ok', valveCount: n, minFlips: k, solutions, truncated };
    }
  }
  return {
    status: 'no-match',
    valveCount: n,
    reason:
      `在最多 ${MAX_FLIPS} 处阀门状态翻转内，没有任何候选能同时解释全部现场观测` +
      '（有水节点可达任一供水点、无水节点不可达）。请核对观测记录，' +
      '或考虑三处及以上阀门状态异常、无阀管段破损 / 堵塞等其他原因。',
  };
}

// ============ 单阀异常观测点规划 ============

/** 候选观测节点数上限 */
export const MAX_OBSERVER_CANDIDATES = 12;

export interface ObserverQuery {
  /** 供水点节点 */
  supplies: string[];
  /** 候选观测节点（去重后不得超过 MAX_OBSERVER_CANDIDATES 个） */
  candidates: string[];
}

/** 一个待区分假设：登记状态（零翻转）或单个阀门单独翻转。 */
export interface ObserverHypothesis {
  /** 假设类型：登记状态（零翻转）/ 单个阀门单独翻转 */
  kind: 'baseline' | 'single-flip';
  /** single-flip 时为被翻转的阀门编号；baseline 时为 null */
  flippedValve: string | null;
  /** 该阀门登记（基线）开闭状态；baseline 时为 null */
  registeredOpen: boolean | null;
  /** 该假设下阀门的实际开闭状态；baseline 时为 null */
  actualOpen: boolean | null;
}

/** 不可区分组：组内各假设在全部候选观测节点上的有水 / 无水签名完全相同。 */
export interface ObserverGroup {
  /** 组内全部假设（登记状态优先，其余按阀门编号升序） */
  hypotheses: ObserverHypothesis[];
  /** 该组在各候选节点（名称升序）上的有水 / 无水签名，true 表示有水（可达任一供水点） */
  signature: boolean[];
  /** 该组在推荐观测点上的预期状态，与推荐点一一对应 */
  expectedStates: boolean[];
}

export interface ObserverPlanOk {
  status: 'ok';
  /** 参与枚举的阀门总数（全部带阀管段，开、关状态均可翻转） */
  valveCount: number;
  /** 假设总数（= 阀门数 + 1） */
  hypothesisCount: number;
  /** 候选观测节点（按名称升序） */
  candidates: string[];
  /** 按签名归并出的不可区分组（组按其首个假设的顺序排列） */
  groups: ObserverGroup[];
  /** 是否能仅靠这些候选节点区分任意两组（全部假设同组时为 false） */
  distinguishable: boolean;
  /** 能区分任意两组的最少观测点节点名称（名称升序）；不可区分时为 null */
  recommendedPoints: string[] | null;
  /** 推荐观测点个数；不可区分时为 0 */
  pointCount: number;
}

export interface ObserverInvalid {
  status: 'invalid';
  errors: string[];
}

export type ObserverPlanResult = ObserverPlanOk | ObserverInvalid;

/**
 * 单阀异常观测点规划：沿用拓扑与供水点（不改拓扑），把「登记状态」与「每个阀门
 * 单独翻转」分别作为一个假设（共阀门数 + 1 个），对每个候选观测节点按「无阀管段 +
 * 实际开启的带阀管段」计算其能否连通任一供水点，得到该假设在该节点上的有水 / 无水签名。
 *
 * - 候选节点上签名完全相同的假设归为一个不可区分组并全部列出；
 * - 对不同组搜索能区分任意两组的最少观测点集合：按观测点个数 k = 1, 2, … 枚举，
 *   同数时按「节点名称升序列表」的字典序取首个；全部假设同组时判定无法靠这些节点区分；
 * - 输出各组在推荐观测点上的预期有水 / 无水状态。
 * 纯函数，不修改输入拓扑与登记的阀门状态。
 */
export function planSingleValveObservers(network: Network, query: ObserverQuery): ObserverPlanResult {
  const errors: string[] = [];
  const nodeSet = new Set(network.nodes);
  if (query.supplies.length === 0) errors.push('至少需要指定一个供水点。');
  for (const s of query.supplies) {
    if (!nodeSet.has(s)) errors.push(`供水点「${s}」不在节点列表中。`);
  }
  if (!Array.isArray(query.candidates)) {
    errors.push('候选观测节点必须是数组。');
  }
  const rawCandidates = Array.isArray(query.candidates) ? query.candidates : [];
  for (const c of rawCandidates) {
    if (typeof c !== 'string' || c.length === 0) {
      errors.push('候选观测节点必须是非空字符串。');
    } else if (!nodeSet.has(c)) {
      errors.push(`候选观测节点「${c}」不在节点列表中。`);
    }
  }
  if (errors.length > 0) return { status: 'invalid', errors };

  const supplies = uniquePreservingOrder(query.supplies);
  // 去重并按名称升序排列：签名列顺序与同数字典序取舍均以此顺序为准
  const candidates = uniquePreservingOrder(rawCandidates).sort((a, b) =>
    a.localeCompare(b, 'zh-Hans-CN')
  );
  if (candidates.length === 0) errors.push('请至少填写一个候选观测节点。');
  if (candidates.length > MAX_OBSERVER_CANDIDATES) {
    errors.push(
      `候选观测节点有 ${candidates.length} 个，超过上限 ${MAX_OBSERVER_CANDIDATES} 个；请精简候选名单后再规划。`
    );
  }
  if (errors.length > 0) return { status: 'invalid', errors };

  const valveIds = network.valvedPipes.map((v) => v.id).sort();
  const indexOf = new Map<string, number>();
  network.nodes.forEach((node, i) => indexOf.set(node, i));
  const candidateIdx = candidates.map((c) => indexOf.get(c)!);
  const supplyIdx = new Set(supplies.map((s) => indexOf.get(s)!));

  // 无阀管段邻接（与阀门状态无关，只需构建一次）；带阀管段按假设实际开闭加入
  const baseAdj: number[][] = Array.from({ length: network.nodes.length }, () => []);
  const addEdge = (adj: number[][], a: number, b: number): void => {
    adj[a].push(b);
    adj[b].push(a);
  };
  for (const p of network.pipes) {
    if (p.from === p.to) continue; // 自环对连通无意义
    addEdge(baseAdj, indexOf.get(p.from)!, indexOf.get(p.to)!);
  }

  /** 计算某阀门单独翻转（flippedId 为 null 表示登记状态）下各候选节点是否有水。 */
  const signatureOf = (flippedId: string | null): boolean[] => {
    const adj: number[][] = baseAdj.map((row) => [...row]);
    for (const vp of network.valvedPipes) {
      if (vp.from === vp.to) continue;
      const actualOpen = flippedId !== null && vp.id === flippedId ? !vp.open : vp.open;
      if (!actualOpen) continue;
      addEdge(adj, indexOf.get(vp.from)!, indexOf.get(vp.to)!);
    }
    const seen = new Array<boolean>(network.nodes.length).fill(false);
    const queue: number[] = [];
    for (const s of supplyIdx) {
      if (!seen[s]) {
        seen[s] = true;
        queue.push(s);
      }
    }
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const next of adj[cur]) {
        if (!seen[next]) {
          seen[next] = true;
          queue.push(next);
        }
      }
    }
    return candidateIdx.map((ci) => seen[ci]);
  };

  // 假设顺序：登记状态优先，其后各阀门按编号升序单独翻转
  const hypotheses: ObserverHypothesis[] = [
    { kind: 'baseline', flippedValve: null, registeredOpen: null, actualOpen: null },
    ...network.valvedPipes
      .map((vp) => ({ id: vp.id, open: vp.open }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((v) => ({
        kind: 'single-flip' as const,
        flippedValve: v.id,
        registeredOpen: v.open,
        actualOpen: !v.open,
      })),
  ];
  // 与 hypotheses 对齐的签名矩阵（每行一个假设）
  const signatures: boolean[][] = [
    signatureOf(null),
    ...valveIds.map((id) => signatureOf(id)),
  ];

  // 按签名归并不可区分组（保持假设首次出现的顺序）
  const groupKeyOf = (sig: boolean[]): string => sig.map((b) => (b ? '1' : '0')).join('');
  const groupIndexByKey = new Map<string, number>();
  const groups: { hypotheses: ObserverHypothesis[]; signature: boolean[] }[] = [];
  signatures.forEach((sig, hi) => {
    const key = groupKeyOf(sig);
    const gi = groupIndexByKey.get(key);
    if (gi === undefined) {
      groupIndexByKey.set(key, groups.length);
      groups.push({ hypotheses: [hypotheses[hi]], signature: sig });
    } else {
      groups[gi].hypotheses.push(hypotheses[hi]);
    }
  });

  if (groups.length === 1) {
    return {
      status: 'ok',
      valveCount: valveIds.length,
      hypothesisCount: hypotheses.length,
      candidates,
      groups: [{ ...groups[0], expectedStates: [] }],
      distinguishable: false,
      recommendedPoints: null,
      pointCount: 0,
    };
  }

  /** 所选候选列能否区分任意两组：等价于每个组在这些列上的签名（位模式）两两不同。 */
  const distinguishesAll = (chosen: number[]): boolean => {
    const seenPatterns = new Set<number>();
    for (const g of groups) {
      let pattern = 0;
      chosen.forEach((ci, bit) => {
        if (g.signature[ci]) pattern |= 1 << bit;
      });
      if (seenPatterns.has(pattern)) return false;
      seenPatterns.add(pattern);
    }
    return true;
  };

  // 按观测点个数 k = 1..m 枚举，同 k 下按候选下标升序（即节点名称升序列表）字典序生成，
  // 首个可区分任意两组的集合即「点数最少 → 名称列表字典序最小」的推荐
  const m = candidates.length;
  let recommended: number[] | null = null;
  for (let k = 1; k <= m && recommended === null; k++) {
    const idx = Array.from({ length: k }, (_, i) => i);
    while (true) {
      if (distinguishesAll(idx)) {
        recommended = [...idx];
        break;
      }
      let i = k - 1;
      while (i >= 0 && idx[i] === m - k + i) i--;
      if (i < 0) break;
      idx[i]++;
      for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
    }
  }

  // 不同组在全部候选上签名必不相同，故全部候选一定可区分，recommended 不可能为 null
  const recommendedIdx = recommended!;
  const recommendedPoints = recommendedIdx.map((ci) => candidates[ci]);

  return {
    status: 'ok',
    valveCount: valveIds.length,
    hypothesisCount: hypotheses.length,
    candidates,
    groups: groups.map((g) => ({
      hypotheses: g.hypotheses,
      signature: g.signature,
      expectedStates: recommendedIdx.map((ci) => g.signature[ci]),
    })),
    distinguishable: true,
    recommendedPoints,
    pointCount: recommendedPoints.length,
  };
}

// ============ 复水开阀顺序规划 ============

/** 复水开阀顺序规划：待开（当前登记为关闭）阀门数量上限 */
export const MAX_REOPEN_VALVES = 8;

/** 复水开阀顺序中的一步。 */
export interface ReopenStep {
  /** 步骤序号（从 1 开始） */
  step: number;
  /** 本步开启的待开阀门编号 */
  valve: string;
  /** 本步开启后按现有共享容量模型重算的总获配量 */
  totalAllocated: number;
  /** 截至本步各步总获配量之和（累计获配） */
  cumulativeAllocated: number;
}

export interface ReopenOk {
  status: 'ok';
  /** 待开阀门数（当前登记为关闭的阀门总数） */
  closedValveCount: number;
  /** 基线参与输水的管段总数（无阀管段 + 当前开启的带阀管段；自环不计） */
  activePipeCount: number;
  /** 基线总获配量（不开启任何待开阀门，与供水能力核验一致） */
  baselineAllocated: number;
  /** 逐步开阀明细（每步开阀编号、该步总获配、累计获配） */
  steps: ReopenStep[];
  /** 最终开阀顺序（= 各步开阀编号依次排列） */
  finalOrder: string[];
  /** 全部待开阀门开启后的总获配量（= 最后一步总获配） */
  finalAllocated: number;
  /** 规划目标值：各步总获配量之和（= 最后一步累计获配） */
  objective: number;
}

/** 待开清单为空：无需复水。 */
export interface ReopenEmpty {
  status: 'empty';
  reason: string;
}

/** 待开阀门超过上限：无法规划。 */
export interface ReopenTooMany {
  status: 'too-many';
  closedValveCount: number;
  reason: string;
}

export interface ReopenInvalid {
  status: 'invalid';
  errors: string[];
}

export type ReopenResult = ReopenOk | ReopenEmpty | ReopenTooMany | ReopenInvalid;

/**
 * 复水开阀顺序规划：沿用供水能力核验的拓扑、供给上限与出口需求，
 * 以当前登记为关闭的阀门为待开清单（最多 MAX_REOPEN_VALVES 个），
 * 规划一个「每步仅开启一个待开阀门、其余阀门保持登记状态不变」的完整开阀顺序，
 * 使**各步开阀后总获配量之和**最大；同分按阀门编号序列字典序取最小。
 *
 * - 每步的获配量按与 verifyCapacity 完全相同的模型重算：无阀管段与当前开启的
 *   带阀管段为双向共享容量 1 的无向边，已开待开阀门自其开启步骤起加入，
 *   其余已关阀与自环不参与；
 * - 目标值只与各步的「已开待开阀门集合」有关：先预计算全部 2^n 个子集的总获配
 *   （n 为待开阀门数），再用子集动态规划求最优顺序——
 *   f(S) = allocated(S) + max_{v∈S} f(S\{v})，同分保留完整序列字典序最小者；
 * - 待开清单为空时返回 empty（无需复水），超过上限时返回 too-many（无法规划）；
 * - 纯函数，不修改输入拓扑、登记的阀门状态与数值表。
 */
export function planReopenSequence(network: Network, query: CapacityQuery): ReopenResult {
  const { valid, errors } = validateCapacityQuery(network, query);
  if (!valid) return { status: 'invalid', errors };
  const { supplyCapList, demandList } = valid;

  // 待开清单：当前登记为关闭的阀门（编号升序）
  const closedValves = network.valvedPipes
    .filter((v) => !v.open)
    .map((v) => v.id)
    .sort();
  if (closedValves.length === 0) {
    return {
      status: 'empty',
      reason: '无需复水：当前没有登记为关闭的阀门，全部阀门均处于开启状态。',
    };
  }
  if (closedValves.length > MAX_REOPEN_VALVES) {
    return {
      status: 'too-many',
      closedValveCount: closedValves.length,
      reason:
        `无法规划：当前登记为关闭的阀门有 ${closedValves.length} 个，超过上限 ${MAX_REOPEN_VALVES} 个；` +
        '请先在输入中将部分阀门标记为开启（"open": true）后再规划。',
    };
  }

  const n = closedValves.length;
  const bitOf = new Map(closedValves.map((id, i) => [id, i]));
  // 基线参与输水的管段（无阀管段 + 当前开启的带阀管段；自环不计）
  const baseEdges = collectActiveEdges(network);
  // 待开阀门对应的管段（自环不参与输水，开启后同样不计入）
  const edgeByValve = new Map<string, ActiveEdge>();
  for (const vp of network.valvedPipes) {
    if (!vp.open && vp.from !== vp.to && bitOf.has(vp.id)) {
      edgeByValve.set(vp.id, { id: vp.id, from: vp.from, to: vp.to });
    }
  }

  // 预计算全部 2^n 个「已开待开阀门子集」下的总获配量（不改动登记状态）
  const subsetCount = 1 << n;
  const allocated: number[] = new Array(subsetCount);
  for (let mask = 0; mask < subsetCount; mask++) {
    const edges = baseEdges.slice();
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        const e = edgeByValve.get(closedValves[i]);
        if (e) edges.push(e);
      }
    }
    allocated[mask] = computeTotalAllocated(network, supplyCapList, demandList, edges, () => 1);
  }

  // 子集动态规划：f(S) = 以某顺序开完 S 中全部阀门时「各步总获配之和」的最大值。
  // 任意顺序的最后一步开完即集合 S，此前是 S\{v} 的某个顺序，故
  // f(S) = allocated(S) + max_{v∈S} f(S\{v})；同分保留完整开阀序列字典序最小者
  // （不同候选的前缀集合不同，完整序列的字典序由前缀决定，子问题最优解可直接拼接）。
  const bestValue: number[] = new Array(subsetCount).fill(0);
  const bestSeq: string[][] = new Array(subsetCount).fill([]);
  for (let mask = 1; mask < subsetCount; mask++) {
    let value = -1;
    let seq: string[] = [];
    for (let i = 0; i < n; i++) {
      if (!(mask & (1 << i))) continue;
      const prev = mask ^ (1 << i);
      const candidateValue = bestValue[prev] + allocated[mask];
      const candidateSeq = [...bestSeq[prev], closedValves[i]];
      if (
        candidateValue > value ||
        (candidateValue === value && compareValveLists(candidateSeq, seq) < 0)
      ) {
        value = candidateValue;
        seq = candidateSeq;
      }
    }
    bestValue[mask] = value;
    bestSeq[mask] = seq;
  }

  const fullMask = subsetCount - 1;
  const finalOrder = bestSeq[fullMask];
  const steps: ReopenStep[] = [];
  let mask = 0;
  let cumulative = 0;
  finalOrder.forEach((valve, idx) => {
    mask |= 1 << bitOf.get(valve)!;
    cumulative += allocated[mask];
    steps.push({
      step: idx + 1,
      valve,
      totalAllocated: allocated[mask],
      cumulativeAllocated: cumulative,
    });
  });

  return {
    status: 'ok',
    closedValveCount: n,
    activePipeCount: baseEdges.length,
    baselineAllocated: allocated[0],
    steps,
    finalOrder,
    finalAllocated: allocated[fullMask],
    objective: bestValue[fullMask],
  };
}

// ============ 关阀作业路线 ============

/** 关阀作业路线：必访阀门（所选方案待关闭阀门）数量上限 */
export const MAX_ROUTE_VALVES = 8;

/** 一条无向作业通道（步行通道），两端为路点，minutes 为步行分钟（正整数）。 */
export interface WorkPassageEdge {
  /** 通道编号，选填，仅用于人工对照 */
  id?: string;
  from: string;
  to: string;
  /** 步行通过该通道所需分钟（正整数）；通道无向，双向耗时相同 */
  minutes: number;
}

/**
 * 作业通道 JSON：路点（与管网拓扑相互独立的步行网络）、无向通道及步行分钟、
 * 各阀门编号对应的作业路点。
 */
export interface WorkPassage {
  /** 全部路点名称（非空字符串，不可重复） */
  waypoints: string[];
  /** 无向步行通道（允许多条并行通道、重复经过） */
  passages: WorkPassageEdge[];
  /** 阀门编号 -> 该阀门作业所在路点（只要求被选中方案用到的阀门有映射） */
  valveWaypoints: Record<string, string>;
}

/** 路线中一段步行：出发段 / 阀门间转场段 / 返程段。 */
export type RouteSegmentKind = 'depart' | 'between' | 'return';

export interface RouteSegment {
  kind: RouteSegmentKind;
  /** 本段起点路点 */
  from: string;
  /** 本段终点路点 */
  to: string;
  /** 本段终点处进行关阀操作的阀门编号；返程段为 null */
  valve: string | null;
  /** 本段实际通行的完整路点序列（含起终点；允许与其他段重复经过路点 / 通道） */
  path: string[];
  /**
   * 本段步行分钟（精确值）：不超出 Number 安全整数范围时为 number（与普通分钟
   * 输入的既有结果一致）；超出时为完整十进制数字字符串，逐位精确、未经舍入。
   */
  minutes: number | string;
}

export interface ClosureRouteQuery {
  /** 管网拓扑（仅用于校验待关闭阀门编号真实存在；测算不修改它） */
  network: Network;
  /** 所选关阀方案待关闭的阀门编号（必访点，去重后按编号升序处理） */
  closedValves: readonly string[];
  /** 作业通道（步行网络） */
  passage: WorkPassage;
  /** 出发路点（路线由此出发并最终返回此点） */
  start: string;
}

export interface ClosureRouteOk {
  status: 'ok';
  start: string;
  /** 必访阀门数（所选方案待关闭阀门去重后数量） */
  requiredValveCount: number;
  /** 关阀操作顺序（阀门编号序列；总耗时最少，同耗时取字典序最小） */
  valveOrder: string[];
  /** 各阀门作业所在路点（阀门编号 -> 路点） */
  valveWaypoints: Record<string, string>;
  /** 逐段路线：出发段、阀门间转场段、返程段 */
  segments: RouteSegment[];
  /**
   * 总步行分钟（各段耗时之和的精确值）：不超出 Number 安全整数范围时为 number；
   * 超出时为完整十进制数字字符串，逐位精确、未经舍入。
   */
  totalMinutes: number | string;
}

/** 必访阀门缺少路点映射。 */
export interface ClosureRouteMissingMap {
  status: 'missing-map';
  /** 缺少 valveWaypoints 映射的阀门编号（升序） */
  missingValves: string[];
  reason: string;
}

/** 必访阀门超过上限。 */
export interface ClosureRouteTooMany {
  status: 'too-many';
  requiredValveCount: number;
  reason: string;
}

/** 出发路点或某些必访阀门路点之间无路可达。 */
export interface ClosureRouteUnreachable {
  status: 'unreachable';
  /** 互不可达的关键位置对（人类可读位置描述，如「出发路点 X」「阀门 V03 所在路点 Y」） */
  pairs: { from: string; to: string }[];
  reason: string;
}

export interface ClosureRouteInvalid {
  status: 'invalid';
  errors: string[];
}

export type ClosureRouteResult =
  | ClosureRouteOk
  | ClosureRouteMissingMap
  | ClosureRouteTooMany
  | ClosureRouteUnreachable
  | ClosureRouteInvalid;

/** 解析并校验作业通道 JSON，返回步行网络或错误列表（纯函数，不修改输入）。 */
export function parseWorkPassage(raw: unknown): { passage?: WorkPassage; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(raw)) {
    return { errors: ['作业通道 JSON 必须是一个对象，包含 waypoints / passages / valveWaypoints 三个字段。'] };
  }

  const waypoints = asStringArray(raw.waypoints);
  if (!waypoints || waypoints.length === 0) {
    errors.push('waypoints 必须是非空字符串数组（路点名称不可为空、不可重复）。');
  }
  const waypointSet = new Set(waypoints ?? []);
  if (waypoints && waypointSet.size !== waypoints.length) {
    errors.push('waypoints 中存在重复路点。');
  }

  const passages: WorkPassageEdge[] = [];
  if (!Array.isArray(raw.passages)) {
    errors.push('passages 必须是数组（每项含 from / to / minutes，可带选填 id）。');
  } else {
    raw.passages.forEach((p, i) => {
      if (!isRecord(p) || typeof p.from !== 'string' || !p.from ||
          typeof p.to !== 'string' || !p.to) {
        errors.push(`passages[${i}] 必须包含非空字符串字段 from / to。`);
        return;
      }
      if (p.id !== undefined && (typeof p.id !== 'string' || !p.id)) {
        errors.push(`passages[${i}] 的 id（选填）必须是非空字符串。`);
      }
      if (typeof p.minutes !== 'number' || !Number.isSafeInteger(p.minutes) || p.minutes <= 0) {
        errors.push(`passages[${i}]（${p.from} ↔ ${p.to}）的 minutes 必须是正整数（收到：${String(p.minutes)}）。`);
      }
      if (waypointSet.size > 0) {
        if (!waypointSet.has(p.from)) errors.push(`passages[${i}] 的起点「${p.from}」未在 waypoints 中声明。`);
        if (!waypointSet.has(p.to)) errors.push(`passages[${i}] 的终点「${p.to}」未在 waypoints 中声明。`);
      }
      if (typeof p.minutes === 'number' && Number.isSafeInteger(p.minutes) && p.minutes > 0) {
        passages.push({ from: p.from, to: p.to, minutes: p.minutes });
      }
    });
  }

  // 无原型键值表：键为用户给出的阀门编号，允许为 __proto__ 等特殊名称
  const valveWaypoints: Record<string, string> = createNullProtoRecord<string>();
  if (!isRecord(raw.valveWaypoints)) {
    errors.push('valveWaypoints 必须是对象：键为阀门编号，值为该阀门作业所在路点。');
  } else {
    for (const [valve, wp] of Object.entries(raw.valveWaypoints)) {
      if (!valve) {
        errors.push('valveWaypoints 中存在空的阀门编号键。');
        continue;
      }
      if (typeof wp !== 'string' || !wp) {
        errors.push(`阀门「${valve}」对应的路点必须是非空字符串。`);
        continue;
      }
      if (waypointSet.size > 0 && !waypointSet.has(wp)) {
        errors.push(`阀门「${valve}」对应的路点「${wp}」未在 waypoints 中声明。`);
        continue;
      }
      valveWaypoints[valve] = wp;
    }
  }

  if (errors.length > 0 || !waypoints) return { errors };
  return { passage: { waypoints, passages, valveWaypoints }, errors: [] };
}

/**
 * 精确分钟值的输出形式：不超出 Number 安全整数范围时保留 number（与普通分钟
 * 输入的既有结果兼容），超出时给完整十进制数字字符串，保证逐位精确、可直接展示。
 */
function exactMinutesOutput(value: bigint): number | string {
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString(10);
}

/**
 * 关阀作业路线：在选定关阀方案的待关闭阀门（必访点，最多 MAX_ROUTE_VALVES 个）上，
 * 以出发路点为起点、沿无向作业通道步行，访问全部必访阀门并返回出发路点的
 * 总步行时间最少的完整路线；允许重复经过路点与通道。
 *
 * 1. 先用 Floyd–Warshall 求全部路点间最短通行距离（正整数分钟；同名端点间取
 *    并行通道最小值），并在最短路等耗时的路点序列间取节点序列字典序最小者；
 * 2. 再用子集动态规划求阀门访问顺序——dp[S][v] 为从出发点出发访问完 S 中阀门
 *    且最后操作 v 的最少耗时，完整路线再加上 v 返回出发点的最短耗时；
 *    同耗时按「关阀操作的阀门编号序列」字典序取最小。
 * 分钟全程以 BigInt 精确整数累加：单条通道 minutes 已是安全整数，但多段相加
 * （如「门→中继」9007199254740991 分钟 +「中继→阀位」2 分钟的单阀往返
 * 18014398509481986 分钟）会超出 Number 安全整数范围，Number 累加会舍入；
 * 全路点最短路、阀门访问顺序优化与逐段 / 总耗时共用同一套精确计算。
 * 输出时安全范围内为 number，超出时为完整十进制字符串。
 * 映射缺失、必访阀门超限、关键位置互不可达时分别给出明确状态。
 * 纯函数测算：不修改拓扑 JSON、阀门登记状态与作业通道输入。
 */
export function planClosureRoute(query: ClosureRouteQuery): ClosureRouteResult {
  const { network, passage, start } = query;
  const errors: string[] = [];

  if (typeof start !== 'string' || !start.trim()) {
    errors.push('请填写出发路点。');
  } else if (!passage.waypoints.includes(start.trim())) {
    errors.push(`出发路点「${start.trim()}」不在作业通道的 waypoints 中。`);
  }
  const knownValves = new Set(network.valvedPipes.map((v) => v.id));
  const badValves = query.closedValves.filter((v) => !knownValves.has(v));
  for (const v of badValves) errors.push(`待关闭阀门「${v}」不在拓扑的带阀管段编号中。`);
  if (errors.length > 0) return { status: 'invalid', errors };

  const startWp = start.trim();
  // 必访阀门：去重后按编号升序（位编号顺序，与字典序取舍一致）
  const required = [...new Set(query.closedValves)].sort();

  // 映射缺失：只认 JSON 实际提供的键，继承属性（toString 等）不算映射
  const missingValves = required.filter((v) => !hasOwnKey(passage.valveWaypoints, v));
  if (missingValves.length > 0) {
    return {
      status: 'missing-map',
      missingValves,
      reason:
        `以下 ${missingValves.length} 个待关闭阀门在 valveWaypoints 中缺少作业路点映射：` +
        `${missingValves.map((v) => `「${v}」`).join('、')}。请在作业通道 JSON 中补全这些阀门对应的路点后再规划。`,
    };
  }

  // 必访阀门数量上限
  if (required.length > MAX_ROUTE_VALVES) {
    return {
      status: 'too-many',
      requiredValveCount: required.length,
      reason:
        `该方案待关闭的阀门有 ${required.length} 个，超过关阀作业路线上限 ${MAX_ROUTE_VALVES} 个；` +
        '请选择待关闭阀门更少的方案后再规划。',
    };
  }

  const m = passage.waypoints.length;
  const idxOf = new Map<string, number>();
  passage.waypoints.forEach((wp, i) => idxOf.set(wp, i));
  // 名称升序的节点次序：等耗时最短路按路点序列字典序取舍
  const nodesByName = [...passage.waypoints].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  // 直连矩阵与全源最短路初始化（并行通道取最小分钟；自环不影响正权最短路）。
  // 分钟全程以 BigInt 精确累加：单条通道 minutes 已是安全整数，但多段相加可能
  // 超出 Number 安全整数范围（Number 累加会舍入）；null 表示不可达（替代 Infinity）。
  const direct: (bigint | null)[][] = Array.from({ length: m }, () => new Array<bigint | null>(m).fill(null));
  const dist: (bigint | null)[][] = Array.from({ length: m }, () => new Array<bigint | null>(m).fill(null));
  for (let i = 0; i < m; i++) {
    direct[i][i] = 0n;
    dist[i][i] = 0n;
  }
  for (const e of passage.passages) {
    const u = idxOf.get(e.from)!;
    const v = idxOf.get(e.to)!;
    if (u === v) continue; // 自环对正权最短通行距离无意义
    const w = BigInt(e.minutes);
    const duv = direct[u][v];
    if (duv === null || w < duv) {
      direct[u][v] = w;
      direct[v][u] = w;
    }
    const dvu = dist[u][v];
    if (dvu === null || w < dvu) {
      dist[u][v] = w;
      dist[v][u] = w;
    }
  }
  // Floyd–Warshall 全源最短路（BigInt 精确相加，不发生 Number 舍入）
  for (let k = 0; k < m; k++) {
    for (let i = 0; i < m; i++) {
      const dik = dist[i][k];
      if (dik === null) continue;
      for (let j = 0; j < m; j++) {
        const dkj = dist[k][j];
        if (dkj === null) continue;
        const via = dik + dkj;
        const dij = dist[i][j];
        if (dij === null || via < dij) dist[i][j] = via;
      }
    }
  }

  const sIdx = idxOf.get(startWp)!;
  const valveIdx = required.map((v) => idxOf.get(passage.valveWaypoints[v])!);

  // 关键位置：出发路点与每个必访阀门所在路点；任一互不可达对都明确报出
  const locations: { label: string; point: number }[] = [
    { label: `出发路点「${startWp}」`, point: sIdx },
    ...required.map((v, i) => ({
      label: `阀门「${v}」所在路点「${passage.valveWaypoints[v]}」`,
      point: valveIdx[i],
    })),
  ];
  const unreachablePairs: { from: string; to: string }[] = [];
  for (let i = 0; i < locations.length; i++) {
    for (let j = i + 1; j < locations.length; j++) {
      if (dist[locations[i].point][locations[j].point] === null) {
        unreachablePairs.push({ from: locations[i].label, to: locations[j].label });
      }
    }
  }
  if (unreachablePairs.length > 0) {
    return {
      status: 'unreachable',
      pairs: unreachablePairs,
      reason:
        '作业通道中存在无路可达的关键位置对，无法从出发点依次到达全部必访阀门并返回；' +
        '请在作业通道 JSON 中补全步行通道后再规划。',
    };
  }

  // 等耗时最短路的最小字典序首跳表：
  // next[u][v] = 名称最小的、位于某条 u→v 最短路上的直连邻居；
  // 逐级递推即得路点序列字典序最小的最短路（首跳较小者整体序列必更小）。
  const next: number[][] = Array.from({ length: m }, () => new Array(m).fill(-1));
  for (let u = 0; u < m; u++) {
    next[u][u] = u;
    for (let v = 0; v < m; v++) {
      const duv = dist[u][v];
      if (u === v || duv === null) continue;
      for (const wName of nodesByName) {
        const w = idxOf.get(wName)!;
        const duw = direct[u][w];
        if (w === u || duw === null) continue;
        const dwv = dist[w][v];
        if (dwv !== null && duw + dwv === duv) {
          next[u][v] = w;
          break;
        }
      }
    }
  }
  const shortestPath = (u: number, v: number): number[] => {
    if (u === v) return [u];
    const path = [u];
    let cur = u;
    while (cur !== v) {
      cur = next[cur][v];
      if (cur === -1) break; // 不会发生：已校验可达
      path.push(cur);
    }
    return path;
  };

  const n = required.length;
  const valveWaypointsResult: Record<string, string> = createNullProtoRecord<string>();
  required.forEach((v) => {
    valveWaypointsResult[v] = passage.valveWaypoints[v];
  });

  // 无需关阀的方案：原地出发并返回，总耗时 0
  if (n === 0) {
    return {
      status: 'ok',
      start: startWp,
      requiredValveCount: 0,
      valveOrder: [],
      valveWaypoints: createNullProtoRecord<string>(),
      segments: [],
      totalMinutes: 0,
    };
  }

  // 子集动态规划：bestCost[mask][last] = 从出发点出发、访问完 mask 中阀门、
  // 最后操作 last 的最少步行分钟（BigInt 精确值，null 表示不可达）；
  // bestSeq 记录同耗时下字典序最小的完整阀门序列。
  const size = 1 << n;
  const bestCost: (bigint | null)[][] = Array.from({ length: size }, () => new Array<bigint | null>(n).fill(null));
  const bestSeq: (string[] | null)[][] = Array.from({ length: size }, () => new Array<string[] | null>(n).fill(null));
  for (let i = 0; i < n; i++) {
    bestCost[1 << i][i] = dist[sIdx][valveIdx[i]];
    bestSeq[1 << i][i] = [required[i]];
  }
  for (let mask = 1; mask < size; mask++) {
    for (let last = 0; last < n; last++) {
      if (!(mask & (1 << last)) || (mask & (mask - 1)) === 0) continue; // 单元素集已初始化
      const prevMask = mask ^ (1 << last);
      let cost: bigint | null = null;
      let seq: string[] | null = null;
      for (let j = 0; j < n; j++) {
        if (!(prevMask & (1 << j))) continue;
        const prevCost = bestCost[prevMask][j];
        const leg = dist[valveIdx[j]][valveIdx[last]];
        if (prevCost === null || leg === null) continue; // 已校验可达，此处仅为类型完备
        const candidateCost = prevCost + leg;
        const candidateSeq = [...bestSeq[prevMask][j]!, required[last]];
        if (
          cost === null ||
          candidateCost < cost ||
          (candidateCost === cost && (seq === null || compareValveLists(candidateSeq, seq) < 0))
        ) {
          cost = candidateCost;
          seq = candidateSeq;
        }
      }
      bestCost[mask][last] = cost;
      bestSeq[mask][last] = seq;
    }
  }

  // 闭合路线：最后一个阀门操作完返回出发点；返程不操作阀门，同耗时仍按完整序列字典序取舍
  const fullMask = size - 1;
  let total: bigint | null = null;
  let order: string[] = [];
  for (let last = 0; last < n; last++) {
    const prevCost = bestCost[fullMask][last];
    const back = dist[valveIdx[last]][sIdx];
    if (prevCost === null || back === null) continue; // 已校验可达，此处仅为类型完备
    const candidateCost = prevCost + back;
    const candidateSeq = bestSeq[fullMask][last]!;
    if (
      total === null ||
      candidateCost < total ||
      (candidateCost === total && compareValveLists(candidateSeq, order) < 0)
    ) {
      total = candidateCost;
      order = candidateSeq;
    }
  }

  // 按最优操作顺序重建逐段实际通道路点（各段内部均为最短步行路径）
  const pointIdxOfValve = new Map(required.map((v, i) => [v, valveIdx[i]]));
  const chain: { valve: string | null; point: number }[] = [
    { valve: null, point: sIdx },
    ...order.map((v) => ({ valve: v, point: pointIdxOfValve.get(v)! })),
    { valve: null, point: sIdx },
  ];
  const segments: RouteSegment[] = [];
  for (let i = 1; i < chain.length; i++) {
    const from = chain[i - 1].point;
    const to = chain[i].point;
    const kind: RouteSegmentKind = i === 1 ? 'depart' : i === chain.length - 1 ? 'return' : 'between';
    segments.push({
      kind,
      from: passage.waypoints[from],
      to: passage.waypoints[to],
      valve: chain[i].valve,
      path: shortestPath(from, to).map((p) => passage.waypoints[p]),
      // 精确分钟值：安全范围内为 number，超出时为完整十进制字符串
      minutes: exactMinutesOutput(dist[from][to]!),
    });
  }

  return {
    status: 'ok',
    start: startWp,
    requiredValveCount: n,
    valveOrder: order,
    valveWaypoints: valveWaypointsResult,
    segments,
    // 总耗时与各段共用同一套 BigInt 精确计算，此处仅做输出换算
    totalMinutes: exactMinutesOutput(total!),
  };
}

// ============ 应急送水站布点 ============

/** 应急送水站：候选站路点最多枚举个数 */
export const MAX_DELIVERY_STATIONS = 8;

/** 一个候选应急送水站。 */
export interface DeliveryStationInput {
  /** 站名（即该站所在的作业通道路点名） */
  name: string;
  /** 该站最多可送出的水量（非负整数） */
  capacity: number;
}

/** 应急送水站布点查询。 */
export interface EmergencyDeliveryQuery extends CapacityQuery {
  /** 候选送水站（去重后最多 MAX_DELIVERY_STATIONS 个，站名须为作业通道路点） */
  stations: DeliveryStationInput[];
  /** 送水员从站到出口允许的最大步行分钟（非负整数） */
  maxWalkMinutes: number;
  /** 保供出口节点名 -> 该出口取水口对应的作业通道路点 */
  outletWaypoints: Record<string, string>;
  /** 作业通道（与关阀作业路线共用的独立步行网络） */
  passage: WorkPassage;
}

/** 一个出口在某送水方案下的受水情况。 */
export interface DeliveryOutletRow {
  /** 保供出口节点名 */
  outlet: string;
  /** 出口取水口路点 */
  waypoint: string;
  /** 待送水量（供水能力核验给出的缺口） */
  need: number;
  /** 本方案实际送到水量 */
  delivered: number;
  /** 仍未补齐的缺口 = need - delivered */
  remaining: number;
  /** 各站对该出口的整数送水分配（仅列送水量 > 0 的站，按站名字典序） */
  byStation: DeliveryAssignment[];
}

/** 某站对某出口的一笔整数送水分配。 */
export interface DeliveryAssignment {
  station: string;
  amount: number;
  /** 该站到该出口取水口的最短步行分钟 */
  walkMinutes: number;
}

/** 选中的送水站及其在方案中的送水明细。 */
export interface DeliveryStationRow {
  /** 站名（即路点名） */
  name: string;
  /** 该站可送水量上限 */
  capacity: number;
  /** 该站实际送出量 */
  used: number;
  /** 该站可服务（最短步行 ≤ 最大步行分钟、且有待送水量）的出口 */
  servedOutlets: string[];
}

export interface EmergencyDeliveryOk {
  status: 'ok';
  /** 参与输水的管段总数（与供水能力核验一致） */
  activePipeCount: number;
  /** 候选站数（去重后） */
  stationCount: number;
  /** 允许的最大步行分钟 */
  maxWalkMinutes: number;
  /** 待送水量合计（= 供水能力核验的总缺口） */
  totalNeed: number;
  /** 方案实际补齐总量 */
  totalDelivered: number;
  /** 最少所需站数 */
  stationUsed: number;
  /** 选中的站（按名称升序） */
  stations: DeliveryStationRow[];
  /** 逐出口分配（按查询中保供出口顺序，仅列待送水量 > 0 的出口） */
  rows: DeliveryOutletRow[];
}

/** 全部候选站也无法补齐全部缺口。 */
export interface EmergencyDeliveryUnsolvable {
  status: 'unsolvable';
  activePipeCount: number;
  stationCount: number;
  maxWalkMinutes: number;
  totalNeed: number;
  /** 启用全部候选站时最多能送出的水量 */
  totalDelivered: number;
  /** 全部候选站启用下的逐出口受水情况 */
  rows: DeliveryOutletRow[];
  /** 仍未补齐的出口（名称升序） */
  uncoveredOutlets: string[];
  reason: string;
}

/** 待送水量合计为 0：无需布点。 */
export interface EmergencyDeliveryEmpty {
  status: 'empty';
  reason: string;
}

export interface EmergencyDeliveryInvalid {
  status: 'invalid';
  errors: string[];
}

export type EmergencyDeliveryResult =
  | EmergencyDeliveryOk
  | EmergencyDeliveryUnsolvable
  | EmergencyDeliveryEmpty
  | EmergencyDeliveryInvalid;

/** 路点名称列表的字典序比较（与页面 zh-Hans-CN 排序一致的确定性比较）。 */
function compareNameLists(a: readonly string[], b: readonly string[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const c = a[i].localeCompare(b[i], 'zh-Hans-CN');
    if (c !== 0) return c < 0 ? -1 : 1;
  }
  return a.length - b.length;
}

/** 在作业通道上求全部路点对最短步行分钟矩阵（不可达为 Infinity；并行通道取最小）。 */
function passageDistances(passage: WorkPassage): number[][] {
  const m = passage.waypoints.length;
  const idxOf = new Map<string, number>();
  passage.waypoints.forEach((wp, i) => idxOf.set(wp, i));
  const dist: number[][] = Array.from({ length: m }, () => new Array(m).fill(Infinity));
  for (let i = 0; i < m; i++) dist[i][i] = 0;
  for (const e of passage.passages) {
    const u = idxOf.get(e.from)!;
    const v = idxOf.get(e.to)!;
    if (u === v) continue; // 自环对正权最短路无意义
    if (e.minutes < dist[u][v]) {
      dist[u][v] = e.minutes;
      dist[v][u] = e.minutes;
    }
  }
  for (let k = 0; k < m; k++) {
    for (let i = 0; i < m; i++) {
      if (dist[i][k] === Infinity) continue;
      for (let j = 0; j < m; j++) {
        const via = dist[i][k] + dist[k][j];
        if (via < dist[i][j]) dist[i][j] = via;
      }
    }
  }
  return dist;
}

/**
 * 应急送水站布点：沿用当前拓扑、供水能力填写表与作业通道 JSON，先做供水能力核验，
 * 以各保供出口的缺口作为待送水量；在用户给出的候选送水站（最多
 * MAX_DELIVERY_STATIONS 个）中枚举站点子集，按作业通道最短步行距离建立
 * 「站 → 出口取水口」可服务关系（最短步行 ≤ 最大步行分钟），用容量流（最大流）
 * 求整数送水分配，选出能补齐全部缺口且站数最少的子集，同数按站点名称升序列表
 * 字典序取舍；无解时给出全部候选站启用下仍未补齐的出口。
 *
 * 容量流网络：超级源点 → 各站（容量为该站可送水量），站 → 可服务出口取水口
 * （容量为该出口待送水量），各出口取水口 → 超级汇点（容量为待送水量）；
 * 流值达到待送水量合计即该子集可补齐全部缺口，汇点弧上的整数流量即逐出口分配。
 * 纯函数测算：不修改拓扑 JSON、阀门登记状态、供水能力数值与作业通道输入。
 */
export function planEmergencyDeliveryStations(
  network: Network,
  query: EmergencyDeliveryQuery
): EmergencyDeliveryResult {
  // 1) 沿用供水能力核验：拓扑、阀门状态、供给上限与出口需求完全一致
  const capacity = verifyCapacity(network, query);
  if (capacity.status === 'invalid') {
    return { status: 'invalid', errors: capacity.errors };
  }
  const activePipeCount = capacity.activePipeCount;

  // 2) 缺口全为 0：无需布点（无需再校验候选站与步行参数；不改管网及阀门状态）
  if (capacity.totalShortfall === 0) {
    return {
      status: 'empty',
      reason:
        '无需布点：供水能力核验显示全部保供出口均已足额（各出口缺口均为 0），' +
        '当前不存在待送水量，管网与阀门状态保持不变。',
    };
  }

  const errors: string[] = [];

  // 候选站：去重（同名保留首个容量），按名称升序（字典序枚举顺序以此为准）
  const stationMap = new Map<string, number>();
  let stationEntryCount = 0;
  if (!Array.isArray(query.stations)) {
    errors.push('候选送水站必须是数组（每项含站路点名 name 与可送水量 capacity）。');
  } else {
    stationEntryCount = query.stations.length;
    for (const s of query.stations) {
      if (!s || typeof s.name !== 'string' || !s.name.trim()) {
        errors.push('每个候选送水站必须包含非空字符串字段 name（站所在路点）。');
        continue;
      }
      const name = s.name.trim();
      if (typeof s.capacity !== 'number' || !Number.isSafeInteger(s.capacity) || s.capacity < 0) {
        errors.push(`送水站「${name}」的可送水量必须是非负整数（收到：${String(s.capacity)}）。`);
        continue;
      }
      if (stationMap.has(name)) {
        errors.push(`候选送水站「${name}」重复，请为每个路点只填写一个站。`);
        continue;
      }
      stationMap.set(name, s.capacity);
    }
  }
  if (stationMap.size > MAX_DELIVERY_STATIONS) {
    errors.push(
      `候选送水站有 ${stationMap.size} 个，超过上限 ${MAX_DELIVERY_STATIONS} 个；请精简候选名单后再布点。`
    );
  }
  if (Array.isArray(query.stations) && stationEntryCount > 0 && stationMap.size === 0) {
    errors.push('没有有效的候选送水站：请修正各站的站路点名与可送水量后重试。');
  }
  if (Array.isArray(query.stations) && stationEntryCount === 0) {
    errors.push('请至少填写一个候选送水站（站路点名与可送水量）。');
  }

  if (
    typeof query.maxWalkMinutes !== 'number' ||
    !Number.isSafeInteger(query.maxWalkMinutes) ||
    query.maxWalkMinutes < 0
  ) {
    errors.push(`最大步行分钟必须是非负整数（收到：${String(query.maxWalkMinutes)}）。`);
  }

  let outletWaypointsValid = false;
  if (!isRecord(query.outletWaypoints)) {
    errors.push('出口到路点的 JSON 映射必须是对象：键为保供出口名，值为该出口取水口所在路点。');
  } else {
    outletWaypointsValid = true;
  }

  // 仅有待送水量 > 0 的出口参与布点
  const needRows = capacity.rows.filter((r) => r.shortfall > 0);
  const needOutletSet = new Set(needRows.map((r) => r.outlet));

  const wpSet = new Set(query.passage.waypoints);
  for (const name of stationMap.keys()) {
    if (!wpSet.has(name)) {
      errors.push(`送水站「${name}」所在路点未在作业通道 JSON 的 waypoints 中声明。`);
    }
  }
  // 清洗后的出口取水口映射（无原型键值表，允许 __proto__ 等特殊出口名）
  const outletWaypointMap: Record<string, string> = createNullProtoRecord<string>();
  // 路点值非法的出口：不再重复报「缺少映射」
  const invalidWaypointOutlets = new Set<string>();
  if (outletWaypointsValid) {
    const rawOutletWaypoints = query.outletWaypoints;
    for (const [outlet, wp] of Object.entries(rawOutletWaypoints)) {
      if (typeof wp !== 'string' || !wp.trim()) {
        errors.push(`保供出口「${outlet}」映射的取水口路点必须是非空字符串。`);
        invalidWaypointOutlets.add(outlet);
        continue;
      }
      const trimmedWp = wp.trim();
      if (!wpSet.has(trimmedWp)) {
        errors.push(`保供出口「${outlet}」的取水口路点「${trimmedWp}」未在作业通道 JSON 的 waypoints 中声明。`);
        invalidWaypointOutlets.add(outlet);
        continue;
      }
      if (!needOutletSet.has(outlet) && !capacity.rows.some((r) => r.outlet === outlet)) {
        errors.push(`出口到路点映射中的「${outlet}」不在保供出口名单中。`);
      }
      // 已足额（缺口为 0）的出口映射多余，忽略，不报错
      outletWaypointMap[outlet] = trimmedWp;
    }
    for (const r of needRows) {
      if (!hasOwnKey(outletWaypointMap, r.outlet)) {
        errors.push(
          invalidWaypointOutlets.has(r.outlet)
            ? `存在缺口的保供出口「${r.outlet}」的取水口路点映射无效，请修正后重新规划。`
            : `存在缺口的保供出口「${r.outlet}」缺少出口取水口路点映射，请在 JSON 中补充其取水口路点。`
        );
      }
    }
  }
  if (errors.length > 0) return { status: 'invalid', errors };

  const stations = [...stationMap.entries()]
    .map(([name, cap]) => ({ name, capacity: cap }))
    .sort((a, b) => compareNameLists([a.name], [b.name]));
  const maxWalk = query.maxWalkMinutes as number;
  const outletWaypointOf = new Map<string, string>(
    needRows.map((r) => [r.outlet, outletWaypointMap[r.outlet]])
  );

  // 3) 作业通道最短步行距离与「站 → 出口」可服务关系
  const dist = passageDistances(query.passage);
  const idxOf = new Map<string, number>();
  query.passage.waypoints.forEach((wp, i) => idxOf.set(wp, i));
  const needs = needRows.map((r) => ({ outlet: r.outlet, need: r.shortfall }));
  /** serviceable[s][o]：站 s 到出口 o 取水口的最短步行分钟；不可达或超限时为 null。 */
  const serviceable: (number | null)[][] = stations.map((s) =>
    needs.map((n) => {
      const d = dist[idxOf.get(s.name)!][idxOf.get(outletWaypointOf.get(n.outlet)!)!];
      return d !== Infinity && d <= maxWalk ? d : null;
    })
  );

  /**
   * 对给定站子集构建容量流求最大送水量与逐弧整数流量。
   * 返回 null 表示站子集为空且仍有待送水量；否则返回流值与站→出口分配矩阵。
   */
  const flowWith = (
    chosen: readonly number[]
  ): { flow: number; alloc: number[][]; stationUsedFlow: number[] } => {
    const ns = chosen.length;
    const no = needs.length;
    // 节点：0..ns-1 站，ns..ns+no-1 出口；源 ns+no，汇 ns+no+1
    const dinic = new CapacityDinic(ns + no);
    const S = dinic.source;
    const T = dinic.sink;
    const alloc: number[][] = Array.from({ length: ns }, () => new Array(no).fill(0));
    const stationArc: number[] = [];
    chosen.forEach((si, k) => {
      stationArc.push(dinic.addArc(S, k, stations[si].capacity));
    });
    for (let o = 0; o < no; o++) {
      dinic.addArc(ns + o, T, needs[o].need);
    }
    const arcRefs: { k: number; o: number; arc: number }[] = [];
    chosen.forEach((si, k) => {
      for (let o = 0; o < no; o++) {
        if (serviceable[si][o] !== null) {
          const arc = dinic.addArc(k, ns + o, needs[o].need);
          arcRefs.push({ k, o, arc });
        }
      }
    });
    const flow = dinic.maxFlow(S, T);
    for (const { k, o, arc } of arcRefs) {
      // 该弧初始容量为出口待送水量，已流量 = 初始 - 残量
      alloc[k][o] = needs[o].need - dinic.residualCap(arc);
    }
    const stationUsedFlow = chosen.map((si, k) =>
      stations[si].capacity - dinic.residualCap(stationArc[k])
    );
    return { flow, alloc, stationUsedFlow };
  };

  const totalNeed = needs.reduce((sum, n) => sum + n.need, 0);

  /** 把某次容量流结果整理为页面展示结构。 */
  const buildRows = (
    chosen: readonly number[],
    alloc: number[][]
  ): { rows: DeliveryOutletRow[]; totalDelivered: number } => {
    const rows: DeliveryOutletRow[] = needs.map((n, o) => {
      const byStation: DeliveryAssignment[] = [];
      chosen.forEach((si, k) => {
        if (alloc[k][o] > 0) {
          byStation.push({
            station: stations[si].name,
            amount: alloc[k][o],
            walkMinutes: serviceable[si][o]!,
          });
        }
      });
      byStation.sort((a, b) => compareNameLists([a.station], [b.station]));
      const delivered = byStation.reduce((sum, x) => sum + x.amount, 0);
      return {
        outlet: n.outlet,
        waypoint: outletWaypointOf.get(n.outlet)!,
        need: n.need,
        delivered,
        remaining: n.need - delivered,
        byStation,
      };
    });
    return { rows, totalDelivered: rows.reduce((sum, r) => sum + r.delivered, 0) };
  };

  // 4) 按站数 k = 0, 1, … 枚举子集；同 k 下按站名称升序列表字典序生成，首个可行即推荐
  const n = stations.length;
  for (let k = 0; k <= n; k++) {
    const idx = Array.from({ length: k }, (_, i) => i);
    while (true) {
      const chosen = idx.slice();
      const { flow, alloc, stationUsedFlow } = flowWith(chosen);
      if (flow >= totalNeed) {
        const { rows, totalDelivered } = buildRows(chosen, alloc);
        const stationRows: DeliveryStationRow[] = chosen.map((si, kk) => ({
          name: stations[si].name,
          capacity: stations[si].capacity,
          used: stationUsedFlow[kk],
          servedOutlets: needs
            .filter((_, o) => alloc[kk][o] > 0)
            .map((nn) => nn.outlet),
        }));
        return {
          status: 'ok',
          activePipeCount,
          stationCount: n,
          maxWalkMinutes: maxWalk,
          totalNeed,
          totalDelivered,
          stationUsed: k,
          stations: stationRows,
          rows,
        };
      }
      if (k === 0) break;
      let i = k - 1;
      while (i >= 0 && idx[i] === n - k + i) i--;
      if (i < 0) break;
      idx[i]++;
      for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
    }
  }

  // 5) 无解：全部候选站启用也无法补齐，逐出口列出仍未补齐者
  const allIdx = stations.map((_, i) => i);
  const { alloc } = flowWith(allIdx);
  const { rows, totalDelivered } = buildRows(allIdx, alloc);
  const uncoveredOutlets = rows.filter((r) => r.remaining > 0).map((r) => r.outlet);
  uncoveredOutlets.sort((a, b) => compareNameLists([a], [b]));
  return {
    status: 'unsolvable',
    activePipeCount,
    stationCount: n,
    maxWalkMinutes: maxWalk,
    totalNeed,
    totalDelivered,
    rows,
    uncoveredOutlets,
    reason:
      `即使启用全部 ${n} 个候选送水站，受站可送水量与最大步行 ${maxWalk} 分钟内的可服务关系限制，` +
      `仍有 ${uncoveredOutlets.length} 个出口的缺口无法补齐：` +
      `${uncoveredOutlets.map((o) => `「${o}」`).join('、')}。` +
      '请增设更靠近这些出口取水口的候选站、提高站可送水量或放宽最大步行分钟后重试。',
  };
}

// ============ 检修阀门操作时段审计 ============

/** 操作日志最多接受的实际操作记录条数。 */
export const MAX_VALVE_AUDIT_RECORDS = 100;

/** 一条实际阀门操作记录：在 minute 分钟把阀门 valve 操作到 open 目标开闭状态。 */
export interface ValveOperationRecord {
  minute: number;
  valve: string;
  open: boolean;
}

/** 检修阀门操作时段审计查询。 */
export interface ValveAuditQuery {
  /** 供水点节点 */
  supplies: string[];
  /** 漏点节点 */
  leak: string;
  /** 保供出口节点 */
  outlets: string[];
  /** 审计起始整数分钟（含） */
  startMinute: number;
  /** 审计结束整数分钟（不含） */
  endMinute: number;
  /** 实际操作记录（最多 MAX_VALVE_AUDIT_RECORDS 条），无需按分钟排序 */
  records: ValveOperationRecord[];
}

/** 左闭右开整数分钟区间 [from, to)。 */
export interface MinuteInterval {
  from: number;
  to: number;
}

/** 同分钟对不同阀门的一次原子变更明细。 */
export interface ValveAuditOperation {
  /** 被操作的阀门编号 */
  valve: string;
  /** 变更前开闭状态 */
  fromOpen: boolean;
  /** 目标开闭状态（变更后） */
  toOpen: boolean;
}

/** 回放中的一次原子变更（同一分钟的不同阀门操作视为一次）。 */
export interface ValveAuditChange {
  /** 变更发生的分钟（变更自该分钟起生效） */
  minute: number;
  /** 本次原子变更的全部阀门操作，按阀门编号升序 */
  operations: ValveAuditOperation[];
  /** 变更后漏点是否仍连通至少一个供水点（带压） */
  leakPressurized: boolean;
  /** 变更后各保供出口是否能连通至少一个供水点（按查询中保供出口顺序） */
  outletsConnected: boolean[];
}

/** 回放时间轴上的一段：自 [from, to) 内无任何变更，连通状态保持不变。 */
export interface ValveAuditSegment {
  from: number;
  to: number;
  /** 本段起始（= 上一次变更后）漏点是否带压 */
  leakPressurized: boolean;
  /** 本段各保供出口是否连通供水点（按查询中保供出口顺序） */
  outletsConnected: boolean[];
  /** 造成本段状态的变更分钟；审计起点段为 null */
  changeMinute: number | null;
}

/** 单个保供出口的断水审计结果。 */
export interface ValveAuditOutletRow {
  outlet: string;
  /** 断水（无法连通任一供水点）时段，左闭右开、相邻已合并 */
  outageIntervals: MinuteInterval[];
  /** 累计断水分钟（= 各断水时段长度之和） */
  outageMinutes: number;
}

export interface ValveAuditOk {
  status: 'ok';
  startMinute: number;
  endMinute: number;
  /** 审计总分钟数 = endMinute - startMinute */
  totalMinutes: number;
  /** 实际操作记录条数 */
  recordCount: number;
  /** 去重后保供出口顺序 */
  outlets: string[];
  /** 漏点仍连通至少一个供水点的带压时段（左闭右开、相邻已合并） */
  leakPressurizedIntervals: MinuteInterval[];
  /** 漏点带压累计分钟 */
  leakPressurizedMinutes: number;
  /** 逐保供出口断水时段与累计断水分钟（按查询中保供出口顺序） */
  outletRows: ValveAuditOutletRow[];
  /** 全部保供出口断水分钟合计 */
  totalOutageMinutes: number;
  /** 回放时间轴分段（按时间排列，零长度段不含） */
  segments: ValveAuditSegment[];
  /** 逐次原子变更（按分钟升序） */
  changes: ValveAuditChange[];
}

export interface ValveAuditInvalid {
  status: 'invalid';
  errors: string[];
}

export type ValveAuditResult = ValveAuditOk | ValveAuditInvalid;

/** 合并左闭右开区间序列中相邻（前一个 to === 下一个 from）的同类区间。 */
function mergeAdjacentIntervals(intervals: MinuteInterval[]): MinuteInterval[] {
  const merged: MinuteInterval[] = [];
  for (const iv of intervals) {
    if (iv.from >= iv.to) continue; // 不产生零长度区间
    const last = merged[merged.length - 1];
    if (last && last.to === iv.from) {
      last.to = iv.to;
    } else {
      merged.push({ from: iv.from, to: iv.to });
    }
  }
  return merged;
}

/**
 * 检修阀门操作时段审计：沿用当前拓扑、供水点、漏点与保供出口（不改登记状态），
 * 在 [startMinute, endMinute) 整数分钟区间内，从阀门登记开闭状态起按分钟回放
 * 实际操作日志。
 *
 * - 同一分钟对不同阀门的操作视为一次原子变更：该分钟全部阀门目标状态同时生效后
 *   才按「无阀管段 + 开启阀门」重算供水点可达节点；
 * - 同一分钟重复操作同一阀门、未知阀门编号或越界时间（分钟不在 [start,end) 内）
 *   一律报输入错误；操作记录最多 100 条；
 * - 以左闭右开区间记录漏点仍连通至少一个供水点的带压时段，以及各保供出口无法
 *   连通任一供水点的断水时段，相邻同类区间合并；给出逐出口累计断水分钟；
 * - 空日志时整段按登记状态覆盖；审计为纯函数测算，不修改拓扑与登记的阀门状态。
 */
export function auditValveOperationWindow(
  network: Network,
  query: ValveAuditQuery
): ValveAuditResult {
  const errors: string[] = [];
  const nodeSet = new Set(network.nodes);

  if (query.supplies.length === 0) errors.push('至少需要指定一个供水点。');
  for (const s of query.supplies) {
    if (!nodeSet.has(s)) errors.push(`供水点「${s}」不在节点列表中。`);
  }
  if (!query.leak) {
    errors.push('必须指定漏点。');
  } else if (!nodeSet.has(query.leak)) {
    errors.push(`漏点「${query.leak}」不在节点列表中。`);
  }
  if (query.leak && query.supplies.includes(query.leak)) {
    errors.push(`漏点「${query.leak}」不能同时是供水点。`);
  }
  const outlets = uniquePreservingOrder(query.outlets);
  for (const o of outlets) {
    if (!nodeSet.has(o)) errors.push(`保供出口「${o}」不在节点列表中。`);
  }

  if (
    typeof query.startMinute !== 'number' ||
    !Number.isSafeInteger(query.startMinute) ||
    query.startMinute < 0
  ) {
    errors.push(`起始分钟必须是非负整数（收到：${String(query.startMinute)}）。`);
  }
  if (
    typeof query.endMinute !== 'number' ||
    !Number.isSafeInteger(query.endMinute) ||
    query.endMinute < 0
  ) {
    errors.push(`结束分钟必须是非负整数（收到：${String(query.endMinute)}）。`);
  }
  if (
    typeof query.startMinute === 'number' &&
    Number.isSafeInteger(query.startMinute) &&
    typeof query.endMinute === 'number' &&
    Number.isSafeInteger(query.endMinute) &&
    query.startMinute >= 0 &&
    query.endMinute >= 0 &&
    query.startMinute > query.endMinute
  ) {
    errors.push(
      `起始分钟（${query.startMinute}）不能晚于结束分钟（${query.endMinute}）；区间左闭右开。`
    );
  }

  if (!Array.isArray(query.records)) {
    errors.push('实际操作记录必须是数组（每项含 minute / valve / open）。');
  } else if (query.records.length > MAX_VALVE_AUDIT_RECORDS) {
    errors.push(
      `实际操作记录有 ${query.records.length} 条，超过上限 ${MAX_VALVE_AUDIT_RECORDS} 条；请精简日志后再审计。`
    );
  }

  if (errors.length > 0) return { status: 'invalid', errors };

  const startMinute = query.startMinute as number;
  const endMinute = query.endMinute as number;
  const records = (query.records as ValveOperationRecord[]) ?? [];

  // 逐条校验记录结构与值域；结构合法的记录再参与同分钟重复阀门与越界判定
  const parsed: ValveOperationRecord[] = [];
  const knownValves = new Set(network.valvedPipes.map((v) => v.id));
  records.forEach((rec, i) => {
    if (!isRecord(rec)) {
      errors.push(`操作记录[${i}] 必须是对象，包含 minute（整数分钟）/ valve（阀门编号）/ open（目标开闭）字段。`);
      return;
    }
    if (
      typeof rec.minute !== 'number' ||
      !Number.isSafeInteger(rec.minute)
    ) {
      errors.push(`操作记录[${i}] 的 minute 必须是整数分钟（收到：${String((rec as { minute?: unknown }).minute)}）。`);
    }
    if (typeof rec.valve !== 'string' || !rec.valve) {
      errors.push(`操作记录[${i}] 的 valve 必须是非空阀门编号。`);
    }
    if (typeof rec.open !== 'boolean') {
      errors.push(`操作记录[${i}] 的 open 必须是布尔值（true 开启 / false 关闭，收到：${String((rec as { open?: unknown }).open)}）。`);
    }
    if (
      typeof rec.minute === 'number' &&
      Number.isSafeInteger(rec.minute) &&
      typeof rec.valve === 'string' &&
      !!rec.valve &&
      typeof rec.open === 'boolean'
    ) {
      if (rec.minute < startMinute || rec.minute >= endMinute) {
        errors.push(
          `操作记录[${i}] 的分钟 ${rec.minute} 越界：必须落在审计区间 [${startMinute}, ${endMinute}) 内（左闭右开）。`
        );
      }
      if (!knownValves.has(rec.valve)) {
        errors.push(`操作记录[${i}] 的阀门「${rec.valve}」不在拓扑的带阀管段编号中（未知阀门）。`);
      }
      parsed.push({ minute: rec.minute, valve: rec.valve, open: rec.open });
    }
  });

  // 按分钟分组（保持日志先后顺序），检出同分钟重复操作同一阀门
  const byMinute = new Map<number, ValveOperationRecord[]>();
  for (const rec of parsed) {
    const list = byMinute.get(rec.minute);
    if (list) {
      if (list.some((r) => r.valve === rec.valve)) {
        errors.push(
          `第 ${rec.minute} 分钟对阀门「${rec.valve}」存在重复操作：同一分钟只能对同一阀门操作一次。`
        );
      }
      list.push(rec);
    } else {
      byMinute.set(rec.minute, [rec]);
    }
  }

  if (errors.length > 0) return { status: 'invalid', errors };

  // 无阀管段邻接（与阀门状态无关，构建一次）；自环对连通无意义，忽略
  const indexOf = new Map<string, number>();
  network.nodes.forEach((node, i) => indexOf.set(node, i));
  const nNodes = network.nodes.length;
  const baseAdj: number[][] = Array.from({ length: nNodes }, () => []);
  for (const p of network.pipes) {
    if (p.from === p.to) continue;
    const u = indexOf.get(p.from)!;
    const v = indexOf.get(p.to)!;
    baseAdj[u].push(v);
    baseAdj[v].push(u);
  }

  // 阀门运行态：自登记状态起回放，审计全程不写回 network
  const valveOpen = new Map<string, boolean>();
  for (const vp of network.valvedPipes) valveOpen.set(vp.id, vp.open);
  const valveEndpoints = new Map(
    network.valvedPipes
      .filter((vp) => vp.from !== vp.to)
      .map((vp) => [vp.id, { u: indexOf.get(vp.from)!, v: indexOf.get(vp.to)! }])
  );

  const supplies = uniquePreservingOrder(query.supplies);
  const supplyIdx = supplies.map((s) => indexOf.get(s)!);
  const leakIdx = indexOf.get(query.leak)!;
  const outletIdx = outlets.map((o) => indexOf.get(o)!);

  /** 按当前阀门开闭状态，从全部供水点做连通性遍历。 */
  const reachableSnapshot = (): { leakConnected: boolean; outletsConnected: boolean[] } => {
    const adj: number[][] = baseAdj.map((row) => [...row]);
    for (const vp of network.valvedPipes) {
      if (!valveOpen.get(vp.id)) continue;
      const ep = valveEndpoints.get(vp.id);
      if (!ep) continue;
      adj[ep.u].push(ep.v);
      adj[ep.v].push(ep.u);
    }
    const seen = new Array<boolean>(nNodes).fill(false);
    const queue: number[] = [];
    for (const s of supplyIdx) {
      if (!seen[s]) {
        seen[s] = true;
        queue.push(s);
      }
    }
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const next of adj[cur]) {
        if (!seen[next]) {
          seen[next] = true;
          queue.push(next);
        }
      }
    }
    return {
      leakConnected: seen[leakIdx],
      outletsConnected: outletIdx.map((oi) => seen[oi]),
    };
  };

  const initial = reachableSnapshot();

  // 各分钟的原子变更按分钟升序回放；分钟内不同阀门的操作同时生效后只重算一次
  const changeMinutes = [...byMinute.keys()].sort((a, b) => a - b);
  const changes: ValveAuditChange[] = [];
  const segments: ValveAuditSegment[] = [];

  let segStart = startMinute;
  let segLeak = initial.leakConnected;
  let segOutlets = initial.outletsConnected;
  let segChangeMinute: number | null = null;

  const pushSegment = (to: number): void => {
    if (to > segStart) {
      segments.push({
        from: segStart,
        to,
        leakPressurized: segLeak,
        outletsConnected: [...segOutlets],
        changeMinute: segChangeMinute,
      });
    }
  };

  for (const minute of changeMinutes) {
    // [segStart, minute) 保持变更前状态
    pushSegment(minute);

    // 原子应用本分钟全部阀门目标状态，记录每只阀门的前后开闭
    const operations: ValveAuditOperation[] = [];
    for (const rec of byMinute.get(minute)!) {
      const fromOpen = valveOpen.get(rec.valve)!;
      operations.push({ valve: rec.valve, fromOpen, toOpen: rec.open });
      valveOpen.set(rec.valve, rec.open);
    }
    operations.sort((a, b) => (a.valve < b.valve ? -1 : a.valve > b.valve ? 1 : 0));

    const snap = reachableSnapshot();
    changes.push({
      minute,
      operations,
      leakPressurized: snap.leakConnected,
      outletsConnected: [...snap.outletsConnected],
    });

    segStart = minute;
    segLeak = snap.leakConnected;
    segOutlets = snap.outletsConnected;
    segChangeMinute = minute;
  }
  pushSegment(endMinute);

  // 汇总漏点带压时段与逐出口断水时段（左闭右开，合并相邻同类区间）
  const leakIntervalsRaw: MinuteInterval[] = [];
  const outageRaw: MinuteInterval[][] = outlets.map(() => []);
  for (const seg of segments) {
    if (seg.leakPressurized) leakIntervalsRaw.push({ from: seg.from, to: seg.to });
    seg.outletsConnected.forEach((connected, oi) => {
      if (!connected) outageRaw[oi].push({ from: seg.from, to: seg.to });
    });
  }
  const leakPressurizedIntervals = mergeAdjacentIntervals(leakIntervalsRaw);
  const lengthOf = (ivs: MinuteInterval[]): number => ivs.reduce((sum, iv) => sum + (iv.to - iv.from), 0);

  const outletRows: ValveAuditOutletRow[] = outlets.map((outlet, oi) => {
    const outageIntervals = mergeAdjacentIntervals(outageRaw[oi]);
    return {
      outlet,
      outageIntervals,
      outageMinutes: lengthOf(outageIntervals),
    };
  });

  return {
    status: 'ok',
    startMinute,
    endMinute,
    totalMinutes: endMinute - startMinute,
    recordCount: records.length,
    outlets,
    leakPressurizedIntervals,
    leakPressurizedMinutes: lengthOf(leakPressurizedIntervals),
    outletRows,
    totalOutageMinutes: outletRows.reduce((sum, r) => sum + r.outageMinutes, 0),
    segments,
    changes,
  };
}
