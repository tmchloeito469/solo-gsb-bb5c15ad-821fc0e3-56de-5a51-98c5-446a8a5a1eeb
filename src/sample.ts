import type { Network, Query } from './solver';

/** 示例拓扑：某展馆环状供水管网 */
export const SAMPLE_NETWORK: Network = {
  nodes: [
    '市政供水S1',
    '备用水箱S2',
    '环管N1',
    '环管N2',
    '环管N3',
    '环管N4',
    '展厅A',
    '展厅B',
    '卫生间',
    '咖啡厅',
    '设备间',
  ],
  pipes: [
    { id: 'P1', from: '展厅A', to: '环管N2' },
    { id: 'P2', from: '咖啡厅', to: '环管N3' },
    { id: 'P3', from: '设备间', to: '环管N4' },
  ],
  valvedPipes: [
    { id: 'V01', from: '市政供水S1', to: '环管N1', open: true },
    { id: 'V02', from: '备用水箱S2', to: '环管N4', open: true },
    { id: 'V03', from: '环管N1', to: '环管N2', open: true },
    { id: 'V04', from: '环管N2', to: '环管N3', open: true },
    { id: 'V05', from: '环管N3', to: '环管N4', open: true },
    { id: 'V06', from: '环管N4', to: '环管N1', open: true },
    { id: 'V07', from: '卫生间', to: '环管N3', open: true },
    { id: 'V08', from: '展厅B', to: '环管N1', open: true },
    { id: 'V09', from: '展厅B', to: '环管N4', open: false },
  ],
};

export const SAMPLE_QUERY: Query = {
  supplies: ['市政供水S1', '备用水箱S2'],
  leak: '环管N2',
  outlets: ['展厅B', '咖啡厅', '卫生间'],
};

/** 示例供水能力核验数值：各供水点供给上限（非负整数）。 */
export const SAMPLE_SUPPLY_CAPS: Record<string, number> = {
  市政供水S1: 5,
  备用水箱S2: 3,
};

/** 示例供水能力核验数值：各保供出口需求量（非负整数）。 */
export const SAMPLE_OUTLET_DEMANDS: Record<string, number> = {
  展厅B: 2,
  咖啡厅: 1,
  卫生间: 2,
};

/** 示例重点出口优先配水：展厅B 为重点保供出口，其余为普通。 */
export const SAMPLE_PRIORITY_OUTLETS: string[] = ['展厅B'];

/** 示例阀门状态异常定位：现场观测有水的节点。 */
export const SAMPLE_WET_NODES: string[] = ['咖啡厅', '卫生间'];

/**
 * 示例阀门状态异常定位：现场观测无水的节点。
 * 登记状态中展厅B 经 V08 供水（应为有水），现场却无水 → 可定位为 V08 实际已关。
 */
export const SAMPLE_DRY_NODES: string[] = ['展厅B'];

/**
 * 示例单阀异常观测点规划：候选观测节点。
 * 单翻 V01~V06 时环上分支签名一致（不可区分组），展厅B 可辨 V08、卫生间可辨 V07，
 * 最少观测点 {卫生间、展厅B} 即可区分全部三组。
 */
export const SAMPLE_OBSERVER_CANDIDATES: string[] = [
  '展厅A',
  '展厅B',
  '咖啡厅',
  '卫生间',
  '设备间',
];

/**
 * 示例关阀作业路线：展馆步行检修通道（与供水管网拓扑相互独立的无向步行网络）。
 * 推荐关阀方案为 [V03, V04]：从「检修大门」出发，依次到 V03、V04 作业后返回；
 * 两种操作顺序总耗时相同（各 24 分钟），同耗时按阀门编号字典序取 V03 → V04。
 */
export const SAMPLE_WORK_PASSAGE = {
  waypoints: [
    '检修大门',
    '路口甲',
    '路口乙',
    '环管N1井位',
    '环管N2井位',
    '环管N3井位',
    '环管N4井位',
    'S1泵房',
    'S2水箱间',
    '展厅B检修口',
    '卫生间检修口',
    '咖啡厅取水口',
  ],
  passages: [
    { id: 'W01', from: '检修大门', to: '路口甲', minutes: 3 },
    { id: 'W02', from: '检修大门', to: '路口乙', minutes: 8 },
    { id: 'W03', from: '路口甲', to: '环管N1井位', minutes: 4 },
    { id: 'W04', from: '环管N1井位', to: '展厅B检修口', minutes: 2 },
    { id: 'W05', from: '环管N1井位', to: 'S1泵房', minutes: 2 },
    { id: 'W06', from: '环管N1井位', to: '环管N2井位', minutes: 5 },
    { id: 'W07', from: '环管N2井位', to: '环管N3井位', minutes: 5 },
    { id: 'W08', from: '环管N3井位', to: '环管N4井位', minutes: 5 },
    { id: 'W09', from: '环管N4井位', to: '环管N1井位', minutes: 6 },
    { id: 'W10', from: '环管N3井位', to: '卫生间检修口', minutes: 2 },
    { id: 'W11', from: '环管N4井位', to: 'S2水箱间', minutes: 2 },
    { id: 'W12', from: '环管N4井位', to: '展厅B检修口', minutes: 3 },
    { id: 'W13', from: '路口乙', to: '环管N3井位', minutes: 4 },
    { id: 'W14', from: '环管N3井位', to: '咖啡厅取水口', minutes: 2 },
  ],
  valveWaypoints: {
    V01: 'S1泵房',
    V02: 'S2水箱间',
    V03: '环管N1井位',
    V04: '环管N2井位',
    V05: '环管N3井位',
    V06: '环管N4井位',
    V07: '卫生间检修口',
    V08: '展厅B检修口',
    V09: '展厅B检修口',
  },
};

/** 示例关阀作业路线：出发路点。 */
export const SAMPLE_ROUTE_START = '检修大门';

/**
 * 示例应急送水站布点：候选送水站路点（每个路点最多一个站）。
 * 供水能力核验下示例总获配为 2、总缺口为 3：展厅B / 咖啡厅 / 卫生间各缺 1。
 */
export const SAMPLE_DELIVERY_STATIONS: string[] = [
  '环管N1井位',
  '环管N3井位',
  '环管N4井位',
  '检修大门',
];

/** 示例应急送水站布点：各候选站可送水量（非负整数）。 */
export const SAMPLE_DELIVERY_CAPS: Record<string, number> = {
  环管N1井位: 3,
  环管N3井位: 3,
  环管N4井位: 3,
  检修大门: 3,
};

/** 示例应急送水站布点：送水员最大步行分钟。 */
export const SAMPLE_DELIVERY_MAX_WALK = 6;

/**
 * 示例应急送水站布点：有缺口保供出口 → 取水口路点映射。
 * 最大步行 6 分钟内：环管N1井位可送展厅B；环管N3井位可送卫生间与咖啡厅；
 * 环管N4井位可送展厅B；检修大门任何出口都不可达。
 * 最少需 2 个站，同数按站名升序列表字典序推荐：环管N1井位 + 环管N3井位。
 */
export const SAMPLE_OUTLET_WAYPOINTS: Record<string, string> = {
  展厅B: '展厅B检修口',
  咖啡厅: '咖啡厅取水口',
  卫生间: '卫生间检修口',
};

/** 示例检修阀门操作时段审计：审计区间（左闭右开，[0, 60) 共 60 分钟）。 */
export const SAMPLE_VALVE_AUDIT_START = 0;
export const SAMPLE_VALVE_AUDIT_END = 60;

/**
 * 示例检修阀门操作时段审计：实际操作日志（最多 100 条，无需按分钟排序）。
 * - 第 5 分钟一次原子变更：关 V03 / V04 / V05，漏点环管N2 与全部供水点断开，
 *   咖啡厅、卫生间所在的环管N3 侧失去供水（断水 [5, 30)）；
 * - 第 30 分钟一次原子变更：开 V03 / V04，漏点经环管N2→V03→环管N1 重新带压，
 *   咖啡厅、卫生间恢复供水；
 * - 第 50 分钟关 V08（V09 登记为关），展厅B 断水 [50, 60)。
 */
export const SAMPLE_VALVE_AUDIT_RECORDS: {
  minute: number;
  valve: string;
  open: boolean;
}[] = [
  { minute: 5, valve: 'V03', open: false },
  { minute: 30, valve: 'V03', open: true },
  { minute: 5, valve: 'V05', open: false },
  { minute: 50, valve: 'V08', open: false },
  { minute: 5, valve: 'V04', open: false },
  { minute: 30, valve: 'V04', open: true },
];
