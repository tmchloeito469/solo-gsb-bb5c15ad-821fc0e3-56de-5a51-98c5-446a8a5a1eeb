import './style.css';
import {
  parseNetwork,
  solve,
  inspectResilience,
  verifyCapacity,
  verifyPriorityCapacity,
  suggestExpansion,
  locateValveAnomalies,
  planSingleValveObservers,
  scanValveClosureRisk,
  planReopenSequence,
  parseWorkPassage,
  planClosureRoute,
  planEmergencyDeliveryStations,
  auditValveOperationWindow,
  MAX_OPEN_VALVES,
  EXPANSION_TARGET_CAPACITY,
  MAX_EXPANSION_PIPES,
  MAX_RISK_OPEN_VALVES,
  MAX_FLIPS,
  MAX_OBSERVER_CANDIDATES,
  MAX_REOPEN_VALVES,
  MAX_ROUTE_VALVES,
  MAX_DELIVERY_STATIONS,
  MAX_VALVE_AUDIT_RECORDS,
  type Query,
  type CapacityQuery,
  type AnomalyQuery,
  type ObserverQuery,
  type ClosureRouteResult,
  type SolveResult,
  type ResilienceResult,
  type CapacityResult,
  type PriorityCapacityResult,
  type ExpansionResult,
  type ExpansionPlan,
  type ValveRiskResult,
  type AnomalyResult,
  type AnomalySolution,
  type ObserverPlanResult,
  type ObserverHypothesis,
  type ReopenResult,
  type EmergencyDeliveryResult,
  type ValveAuditResult,
} from './solver';
import {
  SAMPLE_NETWORK,
  SAMPLE_QUERY,
  SAMPLE_SUPPLY_CAPS,
  SAMPLE_OUTLET_DEMANDS,
  SAMPLE_PRIORITY_OUTLETS,
  SAMPLE_WET_NODES,
  SAMPLE_DRY_NODES,
  SAMPLE_OBSERVER_CANDIDATES,
  SAMPLE_WORK_PASSAGE,
  SAMPLE_ROUTE_START,
  SAMPLE_DELIVERY_STATIONS,
  SAMPLE_DELIVERY_CAPS,
  SAMPLE_DELIVERY_MAX_WALK,
  SAMPLE_OUTLET_WAYPOINTS,
  SAMPLE_VALVE_AUDIT_START,
  SAMPLE_VALVE_AUDIT_END,
  SAMPLE_VALVE_AUDIT_RECORDS,
} from './sample';

const app = document.querySelector<HTMLDivElement>('#app')!;

app.innerHTML = `
  <header>
    <h1>展馆水路检修隔离方案搜索</h1>
    <p class="subtitle">
      粘贴管网拓扑 JSON，指定供水点、漏点与保供出口，可自动搜索最优关阀组合，
      也可对各保供出口做「保供韧性巡检」（按当前阀门开闭状态估算使其断水至少需失效的管段数），
      还可做「供水能力核验」（按供给上限与出口需求量求总供给最大分配、缺口与限制总供给的最小割），
      可将部分保供出口标为「重点」做「重点出口优先配水」（先让重点出口总获配最大，再在此前提下让全部出口总获配最大），
      并能给出「管段增容建议」（在当前阀门状态下枚举将参与输水管段容量由 1 提至 2 的改造方案，最多改造两条），
      还能做「双阀意外关闭风险扫描」（沿用拓扑、阀门登记状态与供水能力填写表，仅对当前开启的阀门模拟单阀或两阀意外关闭，
      最多处理 ${MAX_RISK_OPEN_VALVES} 个开启阀门；以场景获配量比基线减少的数值作为新增缺口，新增缺口严格大于两阀各自单关之和时标为协同失供），
      还可根据现场有水 / 无水观测做「阀门状态异常定位」（以登记的阀门开闭状态为基线，枚举最多 ${MAX_FLIPS} 处状态翻转来解释全部观测），
      并能做「单阀异常观测点规划」（把登记状态与每个阀门单独翻转作为假设，按候选观测节点的有水 / 无水签名归并不可区分组，
      并搜索能区分任意两组的最少观测点集合，最多填 ${MAX_OBSERVER_CANDIDATES} 个候选节点），
      还能做「复水开阀顺序规划」（以当前登记为关闭的阀门为待开清单，最多 ${MAX_REOPEN_VALVES} 个，
      每步仅开启一个待开阀门，规划使各步开阀后总获配量之和最大的完整开阀顺序），
      并能在选定关阀方案后做「关阀作业路线」（另填路点 / 无向通道 / 步行分钟 / 阀门路点的作业通道 JSON 与出发路点，
      先求路点间最短通行距离，再用子集动态规划求出发并返回、总步行时间最少的完整关阀路线，
      同分按阀门编号序列字典序取舍，必访阀门最多 ${MAX_ROUTE_VALVES} 个），
      还能做「应急送水站布点」（沿用当前拓扑、供水能力填写表与作业通道 JSON，以核验给出的各出口缺口为待送水量，
      枚举最多 ${MAX_DELIVERY_STATIONS} 个候选站的子集，按最短步行距离建立可服务关系、用容量流分配整数送水量，
      选能补齐全部缺口且站数最少的方案，同数按站点名称升序列表字典序；无解时列出未补齐出口，缺口全为 0 时提示无需布点），
      还能做「检修阀门操作时段审计」（沿用当前拓扑、供水点、漏点与保供出口，输入起止整数分钟与最多
      ${MAX_VALVE_AUDIT_RECORDS} 条实际阀门操作记录，从登记状态起按分钟回放：同分钟不同阀门作为一次原子变更，
      同分钟重复操作同一阀门、未知阀门或越界时间报错；以左闭右开区间给出漏点带压时段与逐出口断水时段及累计断水分钟；
      空日志按登记状态覆盖整段，测算不改原始状态）。
      组合搜索最多覆盖 ${MAX_OPEN_VALVES} 个当前开启的阀门；求解过程不修改输入中的阀门状态。
    </p>
  </header>
  <main>
    <section class="panel input-panel">
      <div class="panel-title">
        <h2>1. 管网拓扑 JSON</h2>
        <button id="load-sample" type="button">载入示例拓扑</button>
      </div>
      <textarea id="topology" spellcheck="false" placeholder='{"nodes":[...],"pipes":[...],"valvedPipes":[...]}'></textarea>
      <h2>2. 检修条件</h2>
      <div class="fields">
        <label>
          供水点（多个用逗号分隔）
          <input id="supplies" type="text" placeholder="如：市政供水S1, 备用水箱S2" />
        </label>
        <label>
          漏点
          <input id="leak" type="text" placeholder="如：环管N2" />
        </label>
        <label>
          保供出口（多个用逗号分隔）
          <input id="outlets" type="text" placeholder="如：展厅B, 咖啡厅" />
        </label>
      </div>
      <div class="button-row">
        <button id="solve" type="button" class="primary">搜索关阀方案</button>
        <button id="inspect" type="button" class="secondary">保供韧性巡检</button>
      </div>
      <p class="hint">
        巡检沿用上方「供水点」与「保供出口」：无阀管段与开启的带阀管段均按单条失效计，
        已关阀不参与；多供水点作为整体，环路及并行管段分别计数。
      </p>
      <h2>3. 供水能力核验、重点优先配水、管段增容、双阀风险扫描与复水开阀规划</h2>
      <p class="hint">
        为每个供水点填写非负整数<strong>供给上限</strong>、为每个保供出口填写非负整数<strong>需求量</strong>，
        并为每个保供出口选择<strong>重点 / 普通</strong>（默认普通），按当前阀门开闭状态求总供给最大分配
        （每条连通管段容量为 1、同一无向管段双向合计只能占用一次，已关阀不参与）。留空数值按 0 处理。
      </p>
      <button id="build-capacity-form" type="button">按上方供水点 / 保供出口生成填写表</button>
      <div id="capacity-form" class="capacity-form">
        <p class="hint">尚未生成填写表：点击上方按钮后，为各供水点和保供出口填写数值、选择重点出口，再点核验按钮。</p>
      </div>
      <div class="button-row">
        <button id="verify-capacity" type="button" class="secondary">核验供水能力</button>
        <button id="priority-capacity" type="button" class="secondary">重点出口优先配水</button>
        <button id="suggest-expansion" type="button" class="secondary">管段增容建议</button>
        <button id="scan-valve-risk" type="button" class="secondary">双阀意外关闭风险扫描</button>
        <button id="plan-reopen" type="button" class="secondary">复水开阀顺序规划</button>
      </div>
      <p class="hint">
        「重点出口优先配水」分两级目标：先使<strong>重点出口</strong>总获配量最大，再在<strong>不减少该值</strong>的前提下
        使全部出口总获配量最大；第二阶段在残量网络上继续增广，可<strong>改派已分配流量</strong>，不会逐出口占管造成虚假缺口。
        未勾选任何重点出口时，结果与「核验供水能力」的总获配量一致。
      </p>
      <p class="hint">
        增容建议沿用本页拓扑与上方填写的供给上限 / 需求量：仅将参与输水的不同管段（无阀管段或开启阀门）
        容量各由 1 提至 ${EXPANSION_TARGET_CAPACITY}，最多改造 ${MAX_EXPANSION_PIPES} 条；
        已关阀及自环不可选。分别计算不改造、单条与两条组合的总获配量，按
        「总获配量最高 → 改造条数最少 → 管段编号列表字典序最小」推荐方案。
      </p>
      <p class="hint">
        「双阀意外关闭风险扫描」沿用本页拓扑、阀门登记状态与上方填写的供给上限 / 需求量，<strong>不改登记状态</strong>：
        仅对<strong>当前开启</strong>的阀门（最多 ${MAX_RISK_OPEN_VALVES} 个）模拟单阀或两阀意外关闭，
        按现有「无向管段双向共享容量」模型重算最大获配（被模拟关闭的阀门对应管段临时移除，已关阀不参与）。
        以场景获配量比基线减少的数值作为<strong>新增缺口</strong>，全部有损场景按新增缺口降序、阀门编号列表字典序展示；
        两阀新增缺口<strong>严格大于</strong>两个对应单阀新增缺口之和时标为<strong>协同失供</strong>；无有损场景时会明确提示。
      </p>
      <p class="hint">
        「复水开阀顺序规划」沿用本页拓扑、阀门登记状态与上方填写的供给上限 / 需求量，<strong>不改登记状态</strong>：
        以<strong>当前登记为关闭</strong>的阀门为待开清单（最多 ${MAX_REOPEN_VALVES} 个，超限提示无法规划，空清单提示无需复水），
        每步仅开启一个待开阀门、其余阀门保持登记状态不变，按现有「无向管段双向共享容量」模型重算每步总获配，
        规划使<strong>各步开阀后总获配量之和</strong>最大的完整开阀顺序（同分按阀门编号序列字典序取最小），
        并展示基线、每步开阀编号与总获配、累计获配和最终顺序。
      </p>
      <h2>4. 阀门状态异常定位</h2>
      <p class="hint">
        沿用上方拓扑与供水点：把现场观测到的<strong>有水</strong> / <strong>无水</strong>节点分别填入，
        以登记的各带阀管段开闭状态为基线，枚举最多 ${MAX_FLIPS} 处状态翻转（开↔关，已关阀也可被翻为开），
        找出能同时解释全部观测的候选——有水节点须可达任一供水点、无水节点须不可达；只用已观测节点判定匹配。
      </p>
      <div class="fields">
        <label>
          现场有水节点（多个用逗号分隔）
          <input id="wet-nodes" type="text" placeholder="如：咖啡厅, 卫生间" />
        </label>
        <label>
          现场无水节点（多个用逗号分隔）
          <input id="dry-nodes" type="text" placeholder="如：展厅B" />
        </label>
      </div>
      <div class="button-row">
        <button id="locate-anomaly" type="button" class="secondary">定位异常阀门</button>
      </div>
      <h2>5. 单阀异常观测点规划</h2>
      <p class="hint">
        沿用上方拓扑与供水点：填写<strong>最多 ${MAX_OBSERVER_CANDIDATES} 个候选观测节点</strong>，
        把「登记状态」与「每个阀门单独翻转」分别作为假设，按各候选节点能否连通任一供水点生成<strong>有水 / 无水签名</strong>。
        签名相同的假设归为<strong>不可区分组</strong>并列出；再搜索能区分任意两组的<strong>最少观测点集合</strong>
        （同数时按节点名称升序列表的字典序推荐），并展示各组在推荐点的预期状态。求解不改拓扑。
      </p>
      <div class="fields">
        <label>
          候选观测节点（多个用逗号分隔，最多 ${MAX_OBSERVER_CANDIDATES} 个）
          <input id="observer-candidates" type="text" placeholder="如：展厅A, 展厅B, 卫生间" />
        </label>
      </div>
      <div class="button-row">
        <button id="plan-observers" type="button" class="secondary">规划观测点</button>
      </div>
      <h2>6. 关阀作业路线</h2>
      <p class="hint">
        先在右上「关阀方案搜索结果」中<strong>选择一个方案</strong>（默认推荐方案），以该方案待关闭阀门为必访点
        （最多 ${MAX_ROUTE_VALVES} 个），另填<strong>作业通道 JSON</strong>（路点、无向通道及正整数步行分钟、各阀门对应路点）
        与<strong>出发路点</strong>，规划从出发点出发、依次关闭全部必访阀门并返回的总步行时间最少完整路线
        （允许重复经过路点与通道；同耗时按关阀操作的阀门编号序列字典序取舍）。
        通道分钟支持安全整数范围内的任意正整数，分段与总耗时按精确整数计算、以完整十进制展示（超大分钟累加不舍入）。
        测算不修改拓扑与阀门登记状态。
      </p>
      <label>
        作业通道 JSON（waypoints / passages / valveWaypoints）
        <textarea id="work-passage" class="sub-textarea" spellcheck="false"
          placeholder='{"waypoints":["大门",...,"passages":[{"from":"大门","to":"路口","minutes":5}],"valveWaypoints":{"V03":"N2井位"}}'></textarea>
      </label>
      <div class="fields">
        <label>
          出发路点（须包含在 waypoints 中，路线由此出发并返回）
          <input id="route-start" type="text" placeholder="如：检修大门" />
        </label>
      </div>
      <div class="button-row">
        <button id="plan-closure-route" type="button" class="secondary">规划关阀作业路线</button>
      </div>
      <p class="hint" id="selected-solution-hint">尚未选择方案：请先点击「搜索关阀方案」，再在结果中选择一个方案（默认选择推荐方案）。</p>
      <h2>7. 应急送水站布点</h2>
      <p class="hint">
        沿用当前拓扑、上方供水能力填写表与作业通道 JSON：先以<strong>供水能力核验</strong>给出的各出口<strong>缺口</strong>作为待送水量，
        填写<strong>候选站路点</strong>（最多 ${MAX_DELIVERY_STATIONS} 个）、<strong>每站可送水量</strong>、<strong>最大步行分钟</strong>
        与<strong>出口到取水口路点的 JSON 映射</strong>。按作业通道<strong>最短步行距离</strong>建立「站 → 出口」可服务关系，
        枚举站点子集并用<strong>容量流</strong>分配整数送水量，选出能补齐全部缺口且<strong>站数最少</strong>的方案
        （同数按站点名称升序列表字典序），无解时列出仍未补齐的出口；缺口全为 0 时提示无需布点。
        测算<strong>不改原始管网及阀门状态</strong>。
      </p>
      <div class="fields">
        <label>
          候选站路点（多个用逗号分隔，最多 ${MAX_DELIVERY_STATIONS} 个，均须在作业通道 waypoints 中）
          <input id="delivery-stations" type="text" placeholder="如：环管N1井位, 环管N3井位" />
        </label>
        <label>
          最大步行分钟（非负整数，站到出口取水口的最短步行不超过该值才可服务）
          <input id="delivery-max-walk" type="number" min="0" step="1" inputmode="numeric" placeholder="如：6" />
        </label>
      </div>
      <button id="build-delivery-form" type="button">按候选站路点生成可送水量填写表</button>
      <div id="delivery-form" class="capacity-form">
        <p class="hint">尚未生成填写表：填写候选站路点后点击上方按钮，再为各站填写非负整数可送水量。</p>
      </div>
      <label>
        出口到取水口路点的 JSON 映射（仅需覆盖有缺口的出口，路点须在作业通道 waypoints 中）
        <textarea id="outlet-waypoints" class="sub-textarea" spellcheck="false"
          placeholder='{"展厅B":"展厅B检修口","咖啡厅":"咖啡厅取水口"}'></textarea>
      </label>
      <div class="button-row">
        <button id="plan-delivery" type="button" class="secondary">规划应急送水站布点</button>
      </div>
      <h2>8. 检修阀门操作时段审计</h2>
      <p class="hint">
        沿用当前拓扑、上方<strong>供水点</strong>、<strong>漏点</strong>与<strong>保供出口</strong>：
        填写审计<strong>起止整数分钟</strong>（区间左闭右开）与<strong>最多 ${MAX_VALVE_AUDIT_RECORDS} 条实际操作记录</strong>
        （JSON 数组，每项含 <code>minute</code> 分钟、<code>valve</code> 阀门编号、<code>open</code> 目标开闭，无需按分钟排序）。
        从阀门<strong>登记状态</strong>起按分钟回放：同分钟对不同阀门的操作作为<strong>一次原子变更</strong>（同时生效后才重算可达）；
        <strong>同分钟重复操作同一阀门、未知阀门或越界时间</strong>（分钟不在 [起, 止) 内）一律报错。
        空日志（<code>[]</code> 或留空）按登记状态覆盖整段；测算<strong>不改原始状态</strong>。
      </p>
      <div class="fields">
        <label>
          起始整数分钟（含）
          <input id="audit-start" type="number" min="0" step="1" inputmode="numeric" placeholder="如：0" />
        </label>
        <label>
          结束整数分钟（不含）
          <input id="audit-end" type="number" min="0" step="1" inputmode="numeric" placeholder="如：60" />
        </label>
      </div>
      <label>
        实际操作记录 JSON（数组，每项含 minute / valve / open；最多 ${MAX_VALVE_AUDIT_RECORDS} 条）
        <textarea id="valve-audit-log" class="sub-textarea" spellcheck="false"
          placeholder='[{"minute":5,"valve":"V03","open":false}]'></textarea>
      </label>
      <div class="button-row">
        <button id="run-valve-audit" type="button" class="secondary">审计阀门操作时段</button>
      </div>
    </section>
    <div class="side-column">
      <section class="panel result-panel">
        <h2>关阀方案搜索结果</h2>
        <div id="result"><p class="hint">尚未求解。可点击「载入示例拓扑」快速体验。</p></div>
      </section>
      <section class="panel result-panel">
        <h2>关阀作业路线</h2>
        <div id="closure-route-result">
          <p class="hint">
            选择一个关阀方案、填好作业通道 JSON 与出发路点后点击「规划关阀作业路线」，
            这里展示阀门操作顺序、逐段实际通道路点、分段与总耗时；无路可达、映射缺失或必访阀门超过
            ${MAX_ROUTE_VALVES} 个时会给出明确提示。
          </p>
        </div>
      </section>
      <section class="panel result-panel">
        <h2>保供韧性巡检</h2>
        <div id="inspect-result">
          <p class="hint">
            点击「保供韧性巡检」后，这里按「使其失去全部供水至少需失效的不同管段数」升序列出各出口，
            并给出一组达到该数量的管段编号，供安排巡检。
          </p>
        </div>
      </section>
      <section class="panel result-panel">
        <h2>供水能力核验</h2>
        <div id="capacity-result">
          <p class="hint">
            点击「核验供水能力」后，这里展示总供给最大分配、每个出口的获配量与缺口，
            以及一组限制总供给的最小割项目（供给上限、管段或出口需求）。
          </p>
        </div>
      </section>
      <section class="panel result-panel">
        <h2>重点出口优先配水</h2>
        <div id="priority-result">
          <p class="hint">
            在填写表中将部分保供出口选为「重点」后点击「重点出口优先配水」，这里先展示第一级目标值
            （重点出口总获配量），再展示第二级目标值（不减少重点获配前提下的全部出口总获配量），
            并列出每个出口的类别、获配量与缺口，供与「供水能力核验」对照。
          </p>
        </div>
      </section>
      <section class="panel result-panel">
        <h2>管段增容建议</h2>
        <div id="expansion-result">
          <p class="hint">
            点击「管段增容建议」后，这里对比不改造、单条与两条组合改造的总获配量，
            推荐总获配量最高、改造条数最少、管段编号字典序最小的方案；零增量时提示无需增容。
          </p>
        </div>
      </section>
      <section class="panel result-panel">
        <h2>双阀意外关闭风险扫描</h2>
        <div id="valve-risk-result">
          <p class="hint">
            点击「双阀意外关闭风险扫描」后，这里对当前开启的阀门逐个（及两两组合）模拟意外关闭，
            列出全部有新增缺口的场景（按新增缺口降序、阀门编号列表字典序），并把
            「两阀新增缺口严格大于两个单阀新增缺口之和」的场景标为协同失供；无有损场景时会明确提示。
          </p>
        </div>
      </section>
      <section class="panel result-panel">
        <h2>复水开阀顺序规划</h2>
        <div id="reopen-result">
          <p class="hint">
            点击「复水开阀顺序规划」后，这里以当前登记为关闭的阀门为待开清单，
            给出使各步开阀后总获配量之和最大的完整开阀顺序：展示基线总获配、
            每步开启的阀门编号与该步总获配、累计获配，以及最终开阀顺序；
            待开清单为空时提示无需复水，超过上限时提示无法规划。规划不修改登记的阀门状态。
          </p>
        </div>
      </section>
      <section class="panel result-panel">
        <h2>阀门状态异常定位</h2>
        <div id="anomaly-result">
          <p class="hint">
            在左侧填写现场有水 / 无水观测节点后点击「定位异常阀门」，这里列出翻转数最少的全部匹配方案
            （被翻转的阀门及翻转后的开闭状态）；零翻转表示登记状态与现场一致，无匹配表示两处以内无法解释。
          </p>
        </div>
      </section>
      <section class="panel result-panel">
        <h2>单阀异常观测点规划</h2>
        <div id="observer-result">
          <p class="hint">
            在左侧填写候选观测节点后点击「规划观测点」，这里列出登记状态与每个阀门单独翻转等假设的
            不可区分分组，给出能区分任意两组的最少观测点集合（同数按节点名称升序列表字典序推荐），
            并展示各组在推荐点的预期有水 / 无水状态；全部假设同组时说明无法靠这些节点区分。
          </p>
        </div>
      </section>
      <section class="panel result-panel">
        <h2>应急送水站布点</h2>
        <div id="delivery-result">
          <p class="hint">
            填好候选站路点、各站可送水量、最大步行分钟与出口到路点映射后点击「规划应急送水站布点」，
            这里以供水能力核验的各出口缺口为待送水量，给出能补齐全部缺口且站数最少的布点方案
            （站点、逐出口整数送水分配与总补齐量）；全部候选站也无法补齐时列出未补齐出口，
            缺口全为 0 时提示无需布点。布点测算不修改管网与阀门状态。
          </p>
        </div>
      </section>
      <section class="panel result-panel">
        <h2>检修阀门操作时段审计</h2>
        <div id="valve-audit-result">
          <p class="hint">
            填好起止整数分钟与实际操作记录 JSON 后点击「审计阀门操作时段」，这里从登记状态起按分钟回放，
            以左闭右开区间给出漏点仍连通供水点的带压时段、各保供出口的断水时段（相邻同类区间已合并）
            与逐出口累计断水分钟，并列出每次原子变更明细；空日志按登记状态覆盖整段。
          </p>
        </div>
      </section>
    </div>
  </main>
`;

function el<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`缺少元素 ${selector}`);
  return node;
}

const topologyEl = el<HTMLTextAreaElement>('#topology');
const suppliesEl = el<HTMLInputElement>('#supplies');
const leakEl = el<HTMLInputElement>('#leak');
const outletsEl = el<HTMLInputElement>('#outlets');
const wetNodesEl = el<HTMLInputElement>('#wet-nodes');
const dryNodesEl = el<HTMLInputElement>('#dry-nodes');
const observerCandidatesEl = el<HTMLInputElement>('#observer-candidates');
const workPassageEl = el<HTMLTextAreaElement>('#work-passage');
const routeStartEl = el<HTMLInputElement>('#route-start');
const deliveryStationsEl = el<HTMLInputElement>('#delivery-stations');
const deliveryMaxWalkEl = el<HTMLInputElement>('#delivery-max-walk');
const outletWaypointsEl = el<HTMLTextAreaElement>('#outlet-waypoints');
const auditStartEl = el<HTMLInputElement>('#audit-start');
const auditEndEl = el<HTMLInputElement>('#audit-end');
const valveAuditLogEl = el<HTMLTextAreaElement>('#valve-audit-log');
const selectedSolutionHintEl = el<HTMLParagraphElement>('#selected-solution-hint');
const resultEl = el<HTMLDivElement>('#result');
const inspectResultEl = el<HTMLDivElement>('#inspect-result');
const closureRouteResultEl = el<HTMLDivElement>('#closure-route-result');
const capacityFormEl = el<HTMLDivElement>('#capacity-form');
const capacityResultEl = el<HTMLDivElement>('#capacity-result');
const priorityResultEl = el<HTMLDivElement>('#priority-result');
const expansionResultEl = el<HTMLDivElement>('#expansion-result');
const valveRiskResultEl = el<HTMLDivElement>('#valve-risk-result');
const reopenResultEl = el<HTMLDivElement>('#reopen-result');
const anomalyResultEl = el<HTMLDivElement>('#anomaly-result');
const observerResultEl = el<HTMLDivElement>('#observer-result');
const deliveryFormEl = el<HTMLDivElement>('#delivery-form');
const deliveryResultEl = el<HTMLDivElement>('#delivery-result');
const valveAuditResultEl = el<HTMLDivElement>('#valve-audit-result');

/** 已生成填写表对应的供水点 / 保供出口。 */
interface CapacityFormState {
  supplies: string[];
  outlets: string[];
}
let capacityFormState: CapacityFormState | null = null;

/** 已生成可送水量填写表对应的候选送水站路点。 */
let deliveryFormState: string[] | null = null;

/** 当前在关阀方案结果中选中的方案（待关闭阀门编号）；null 表示尚未选择有效方案。 */
let selectedClosedValves: string[] | null = null;
/** 最近一次关阀方案搜索结果，供「选择该方案」按钮读取。 */
let lastSolveResult: SolveResult | null = null;

/** 刷新「已选方案」提示。 */
function renderSelectedSolutionHint(): void {
  if (selectedClosedValves === null) {
    selectedSolutionHintEl.textContent =
      '尚未选择方案：请先点击「搜索关阀方案」，再在结果中选择一个方案（默认选择推荐方案）。';
    selectedSolutionHintEl.className = 'hint';
    return;
  }
  selectedSolutionHintEl.innerHTML =
    `已选方案（必访阀门 ${selectedClosedValves.length} 个）：` +
    (selectedClosedValves.length > 0
      ? selectedClosedValves.map((v) => `<code>${escapeHtml(v)}</code>`).join('、')
      : '无需关阀');
  selectedSolutionHintEl.className = 'hint selected-hint';
}

/** 在关阀方案结果中选择某个方案作为作业路线的必访点（由结果区按钮事件委托调用）。 */
function selectSolution(index: number): void {
  const current = lastSolveResult;
  if (!current || current.status !== 'ok') return;
  const sol = current.solutions[index];
  if (!sol) return;
  selectedClosedValves = [...sol.closed];
  renderSelectedSolutionHint();
}

function splitList(text: string): string[] {
  return text
    .split(/[,，;；\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]!));
}

function renderErrors(target: HTMLElement, title: string, errors: string[]): void {
  target.innerHTML = `
    <div class="banner error">${escapeHtml(title)}</div>
    <ul class="error-list">
      ${errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}
    </ul>`;
}

/**
 * 渲染各操作 catch 到的错误：readNetwork 抛出的拓扑错误按原样展示；
 * 其余意外错误也要在结果区给出可展示信息，避免结果区因异常而不可用。
 */
function renderCaughtError(target: HTMLElement, e: unknown): void {
  const topologyErrors = (e as { topologyErrors?: unknown } | null)?.topologyErrors;
  if (Array.isArray(topologyErrors) && topologyErrors.every((x) => typeof x === 'string')) {
    renderErrors(target, '拓扑校验失败：', topologyErrors as string[]);
    return;
  }
  renderErrors(target, '操作失败：', [e instanceof Error ? e.message : String(e)]);
}

function renderResult(result: SolveResult, query: Query): void {
  lastSolveResult = result;
  if (result.status === 'invalid') {
    selectedClosedValves = null;
    renderSelectedSolutionHint();
    renderErrors(resultEl, '输入有误，无法求解：', result.errors);
    return;
  }
  if (result.status === 'no-solution') {
    selectedClosedValves = null;
    renderSelectedSolutionHint();
    resultEl.innerHTML = `
      <div class="banner error">无解：当前条件下不存在满足要求的关阀组合。</div>
      <p>${escapeHtml(result.reason)}</p>
      <p class="hint">参与搜索的开启阀门数：${result.openValveCount}</p>`;
    return;
  }

  // 默认选择推荐方案（首个、字典序最小）；重新求解后若原选方案仍在则保留
  if (
    selectedClosedValves === null ||
    !result.solutions.some(
      (s) =>
        s.closed.length === selectedClosedValves!.length &&
        s.closed.every((v, i) => v === selectedClosedValves![i])
    )
  ) {
    selectedClosedValves = [...result.solutions[0].closed];
  }
  renderSelectedSolutionHint();

  const best = result.solutions[0];
  const rows = (sol: typeof best) =>
    sol.outletStatus
      .map(
        (o) => `
        <tr>
          <td>${escapeHtml(o.outlet)}</td>
          <td class="${o.connected ? 'ok' : 'bad'}">${o.connected ? '✓ 正常供水' : '✗ 断水'}</td>
          <td>${o.reachableSupplies.map(escapeHtml).join('、') || '—'}</td>
        </tr>`
      )
      .join('');

  resultEl.innerHTML = `
    <div class="banner success">
      找到 ${result.solutions.length}${result.truncated ? '+' : ''} 个最优方案：
      最少需关闭 <strong>${result.minClosed}</strong> 个阀门。
      推荐方案（同数按阀门编号字典序最小）：关闭
      ${best.closed.length > 0 ? best.closed.map((v) => `<code>${escapeHtml(v)}</code>`).join('、') : '（无需关阀）'}
    </div>
    <p class="hint">
      参与搜索的当前开启阀门数：${result.openValveCount}；
      漏点「${escapeHtml(query.leak)}」在所有方案中均已与全部供水点断开；
      输入 JSON 中的阀门开闭状态不会被修改。
    </p>
    <p class="hint">在下方选择一个方案用于「关阀作业路线」（必访阀门即该方案待关闭阀门，默认已选推荐方案）。</p>
    ${result.solutions
      .map(
        (sol, i) => {
          const isSelected =
            selectedClosedValves !== null &&
            sol.closed.length === selectedClosedValves.length &&
            sol.closed.every((v, j) => v === selectedClosedValves![j]);
          return `
      <details class="solution" ${i === 0 ? 'open' : ''}>
        <summary>
          方案 ${i + 1}：关闭 ${sol.closed.length} 个阀门
          ${sol.closed.length > 0 ? `（${sol.closed.map(escapeHtml).join('、')}）` : ''}
        </summary>
        <div class="solution-actions">
          <button type="button" class="select-solution-btn${isSelected ? ' selected' : ''}" data-solution-index="${i}">
            ${isSelected ? '✓ 已选为作业路线方案' : '选择该方案用于作业路线'}
          </button>
        </div>
        <table>
          <thead>
            <tr><th>保供出口</th><th>连通状态</th><th>可达供水点</th></tr>
          </thead>
          <tbody>${rows(sol)}</tbody>
        </table>
      </details>`;
        }
      )
      .join('')}
    ${result.truncated ? '<p class="hint">最优方案过多，仅展示前 100 个。</p>' : ''}`;
}

function renderInspection(result: ResilienceResult): void {
  if (result.status === 'invalid') {
    renderErrors(inspectResultEl, '输入有误，无法巡检：', result.errors);
    return;
  }

  const rows = result.rows.map((row) => {
    if (!row.assessable) {
      return `
        <tr>
          <td>${escapeHtml(row.outlet)}</td>
          <td><span class="tag tag-skip">无法评估</span></td>
          <td class="num">—</td>
          <td>${escapeHtml(row.reason)}</td>
        </tr>`;
    }
    const tag = row.alreadyCut
      ? '<span class="tag tag-cut">已断水</span>'
      : row.minFailures === 1
        ? '<span class="tag tag-low">薄弱</span>'
        : '<span class="tag tag-ok">有韧性</span>';
    const pipes =
      row.witnessPipes.length > 0
        ? row.witnessPipes.map((p) => `<code>${escapeHtml(p)}</code>`).join('、')
        : '<span class="hint">（空清单）</span>';
    return `
      <tr>
        <td>${escapeHtml(row.outlet)}</td>
        <td>${tag}</td>
        <td class="num"><strong>${row.minFailures}</strong></td>
        <td>${pipes}</td>
      </tr>`;
  });

  inspectResultEl.innerHTML = `
    <div class="banner success">
      巡检完成：共评估 ${result.rows.length} 个保供出口，参与计数的管段
      （无阀管段 + 当前开启的带阀管段）共 <strong>${result.activePipeCount}</strong> 条；
      已关阀不参与。结果已按所需失效数升序排列。
    </div>
    <table>
      <thead>
        <tr><th>保供出口</th><th>状态</th><th>至少需失效管段数</th><th>一组达到该数量的管段（巡检清单）</th></tr>
      </thead>
      <tbody>${rows.join('')}</tbody>
    </table>
    <p class="hint">
      数值表示：在当前阀门开闭状态下，使该出口与全部供水点断开，至少需要同时失效多少条不同管段
      （多供水点作为整体；环路及并行管段分别计数）。已断水出口显示 0 与空清单；
      出口与供水点同名时无法按管段失效评估。数值越小越应优先巡检，右侧管段为一组最薄弱环节。
    </p>`;
}

/** 渲染供水能力核验的数值填写表（保留已有同值输入与重点选择）。 */
function buildCapacityForm(
  supplies: string[],
  outlets: string[],
  prevCaps?: Record<string, number>,
  prevDemands?: Record<string, number>,
  prevPriority?: ReadonlySet<string>
): void {
  const valueOr = (map: Record<string, number> | undefined, key: string): string => {
    if (!map) return '';
    const v = map[key];
    return v === undefined ? '' : String(v);
  };
  const supplyInputs = supplies
    .map(
      (s) => `
        <label class="cap-row">
          <span>${escapeHtml(s)}</span>
          <input
            type="number"
            min="0"
            step="1"
            inputmode="numeric"
            data-supply="${escapeHtml(s)}"
            value="${valueOr(prevCaps, s)}"
            placeholder="供给上限"
          />
        </label>`
    )
    .join('');
  const outletInputs = outlets
    .map((o) => {
      const isPriority = prevPriority?.has(o) ?? false;
      return `
        <label class="cap-row cap-row-outlet">
          <span>${escapeHtml(o)}</span>
          <input
            type="number"
            min="0"
            step="1"
            inputmode="numeric"
            data-outlet="${escapeHtml(o)}"
            value="${valueOr(prevDemands, o)}"
            placeholder="需求量"
          />
          <select data-priority="${escapeHtml(o)}" aria-label="保供出口 ${escapeHtml(o)} 的重点 / 普通类别">
            <option value="normal"${isPriority ? '' : ' selected'}>普通</option>
            <option value="priority"${isPriority ? ' selected' : ''}>重点</option>
          </select>
        </label>`;
    })
    .join('');
  capacityFormEl.innerHTML = `
    <div class="cap-grid">
      <div>
        <h3>供水点供给上限</h3>
        ${supplies.length > 0 ? supplyInputs : '<p class="hint">请先在上方填写至少一个供水点。</p>'}
      </div>
      <div>
        <h3>保供出口需求量与类别</h3>
        ${outlets.length > 0 ? outletInputs : '<p class="hint">请先在上方填写至少一个保供出口。</p>'}
        ${outlets.length > 0 ? '<p class="hint">类别默认为「普通」；选为「重点」的出口在「重点出口优先配水」中优先获得分配。</p>' : ''}
      </div>
    </div>`;
  capacityFormState = { supplies, outlets };
}

/** 读取填写表中的非负整数与重点出口选择；返回错误信息列表（空串与纯空白按 0）。 */
function readCapacityNumbers(): {
  supplyCaps: Record<string, number>;
  outletDemands: Record<string, number>;
  priorityOutlets: string[];
  errors: string[];
} {
  // 使用无原型对象承载数值：节点名允许为 toString / constructor / __proto__ 等特殊字符串
  const supplyCaps: Record<string, number> = Object.create(null) as Record<string, number>;
  const outletDemands: Record<string, number> = Object.create(null) as Record<string, number>;
  const priorityOutlets: string[] = [];
  const errors: string[] = [];
  if (!capacityFormState) {
    return { supplyCaps, outletDemands, priorityOutlets, errors: ['请先生成供水能力填写表。'] };
  }

  const parseInput = (input: HTMLInputElement): number | null => {
    const isSupply = input.dataset.supply !== undefined;
    const name = isSupply ? input.dataset.supply! : input.dataset.outlet!;
    const fieldLabel = isSupply ? '供给上限' : '需求量';
    const ownerLabel = isSupply ? '供水点' : '保供出口';
    const text = input.value.trim();
    if (text === '') return 0;
    if (!/^\d+$/.test(text)) {
      errors.push(`${ownerLabel}「${name}」的${fieldLabel}必须是非负整数。`);
      return null;
    }
    const n = Number(text);
    if (!Number.isSafeInteger(n)) {
      errors.push(`${ownerLabel}「${name}」的${fieldLabel}数值过大。`);
      return null;
    }
    return n;
  };

  capacityFormEl.querySelectorAll<HTMLInputElement>('input[data-supply]').forEach((input) => {
    const n = parseInput(input);
    if (n !== null) supplyCaps[input.dataset.supply!] = n;
  });
  capacityFormEl.querySelectorAll<HTMLInputElement>('input[data-outlet]').forEach((input) => {
    const n = parseInput(input);
    if (n !== null) outletDemands[input.dataset.outlet!] = n;
  });
  capacityFormEl.querySelectorAll<HTMLSelectElement>('select[data-priority]').forEach((select) => {
    if (select.value === 'priority') priorityOutlets.push(select.dataset.priority!);
  });
  return { supplyCaps, outletDemands, priorityOutlets, errors };
}

/** 渲染候选送水站的可送水量填写表（重新生成时保留同名站已填数值）。 */
function buildDeliveryForm(stations: string[], prevCaps?: Record<string, number>): void {
  const rows = stations
    .map(
      (s) => `
        <label class="cap-row">
          <span>${escapeHtml(s)}</span>
          <input
            type="number"
            min="0"
            step="1"
            inputmode="numeric"
            data-station="${escapeHtml(s)}"
            value="${prevCaps && prevCaps[s] !== undefined ? String(prevCaps[s]) : ''}"
            placeholder="可送水量"
          />
        </label>`
    )
    .join('');
  deliveryFormEl.innerHTML = `
    <div class="cap-grid">
      <div>
        <h3>各候选站可送水量</h3>
        ${stations.length > 0 ? rows : '<p class="hint">请先在上方填写至少一个候选站路点。</p>'}
        ${stations.length > 0 ? '<p class="hint">留空按 0 处理；每站按其可送水量上限参与容量流分配。</p>' : ''}
      </div>
    </div>`;
  deliveryFormState = stations;
}

/** 读取候选站可送水量填写表（留空按 0）；返回错误信息列表。 */
function readDeliveryNumbers(): { caps: Record<string, number>; errors: string[] } {
  // 无原型对象：站名允许为 toString / constructor / __proto__ 等特殊字符串
  const caps: Record<string, number> = Object.create(null) as Record<string, number>;
  const errors: string[] = [];
  if (!deliveryFormState) return { caps, errors: ['请先生成候选站可送水量填写表。'] };
  deliveryFormEl.querySelectorAll<HTMLInputElement>('input[data-station]').forEach((input) => {
    const name = input.dataset.station!;
    const text = input.value.trim();
    if (text === '') {
      caps[name] = 0;
      return;
    }
    if (!/^\d+$/.test(text)) {
      errors.push(`送水站「${name}」的可送水量必须是非负整数。`);
      return;
    }
    const n = Number(text);
    if (!Number.isSafeInteger(n)) {
      errors.push(`送水站「${name}」的可送水量数值过大。`);
      return;
    }
    caps[name] = n;
  });
  return { caps, errors };
}

const CUT_KIND_LABEL: Record<import('./solver').CapacityCutKind, string> = {
  supply: '供给上限',
  pipe: '管段',
  demand: '出口需求',
};

function renderCapacity(result: CapacityResult): void {
  if (result.status === 'invalid') {
    renderErrors(capacityResultEl, '输入有误，无法核验：', result.errors);
    return;
  }

  const outletRows = result.rows
    .map(
      (o) => `
      <tr>
        <td>${escapeHtml(o.outlet)}</td>
        <td class="num">${o.demand}</td>
        <td class="num"><strong>${o.allocated}</strong></td>
        <td class="num ${o.shortfall > 0 ? 'bad' : 'ok'}">${o.shortfall}</td>
        <td>${o.fullySupplied ? '<span class="tag tag-ok">足额</span>' : '<span class="tag tag-cut">缺口</span>'}</td>
      </tr>`
    )
    .join('');

  const supplyRows = result.supplyRows
    .map(
      (s) => `
      <tr>
        <td>${escapeHtml(s.supply)}</td>
        <td class="num">${s.cap}</td>
        <td class="num">${s.used}</td>
        <td class="num ${s.used >= s.cap && s.cap > 0 ? 'bad' : ''}">${s.cap - s.used}</td>
      </tr>`
    )
    .join('');

  const cutList =
    result.cutItems.length > 0
      ? `<ul class="cut-list">
          ${result.cutItems
            .map(
              (c) => `
            <li>
              <span class="tag tag-kind tag-${c.kind}">${CUT_KIND_LABEL[c.kind]}</span>
              <code>${escapeHtml(c.id)}</code>
              <span class="hint">限制容量 ${c.capacity}</span>
            </li>`
            )
            .join('')}
        </ul>
        <p class="hint">上述项目容量合计 <strong>${result.cutCapacity}</strong>，恰等于总获配量（最大流 = 最小割）。</p>`
      : '<p class="hint">总获配量为 0，不存在容量为正的限制项（当前阀门状态下供水点与出口完全不通，或供给上限/需求量均为 0）。</p>';

  const bannerClass = result.totalShortfall > 0 ? 'warn' : 'success';
  const banner =
    result.totalShortfall > 0
      ? `总供给最大分配 <strong>${result.totalAllocated}</strong> / 总需求 ${result.totalDemand}，
         总缺口 <strong>${result.totalShortfall}</strong>：当前供水能力无法足额满足全部出口。`
      : `总供给最大分配 <strong>${result.totalAllocated}</strong>，全部出口需求均已足额满足
         （总供给上限 ${result.totalSupplyCap}，总需求 ${result.totalDemand}）。`;

  capacityResultEl.innerHTML = `
    <div class="banner ${bannerClass}">${banner}</div>
    <table>
      <thead>
        <tr><th>保供出口</th><th>需求量</th><th>获配量</th><th>缺口</th><th>状态</th></tr>
      </thead>
      <tbody>${outletRows}</tbody>
    </table>
    <details>
      <summary>各供水点供出情况（上限 / 已供 / 富余）</summary>
      <table>
        <thead>
          <tr><th>供水点</th><th>供给上限</th><th>已供出</th><th>富余</th></tr>
        </thead>
        <tbody>${supplyRows}</tbody>
      </table>
    </details>
    <h3>一组限制总供给的最小割项目</h3>
    ${cutList}
    <p class="hint">
      参与输水的管段（无阀管段 + 当前开启的带阀管段）共 ${result.activePipeCount} 条，
      每条容量为 1；同一无向管段双向合计只能占用一次，已关阀不参与。
      最小割项目可能是某个供水点的供给上限、某条管段或某个出口的需求量——它们共同卡住了总供给。
    </p>`;
}

function renderPriorityCapacity(result: PriorityCapacityResult): void {
  if (result.status === 'invalid') {
    renderErrors(priorityResultEl, '输入有误，无法优先配水：', result.errors);
    return;
  }

  const outletRows = result.rows
    .map((o) => {
      const tag =
        o.category === 'priority'
          ? '<span class="tag tag-priority">重点</span>'
          : '<span class="tag tag-normal">普通</span>';
      return `
      <tr>
        <td>${escapeHtml(o.outlet)}</td>
        <td>${tag}</td>
        <td class="num">${o.demand}</td>
        <td class="num"><strong>${o.allocated}</strong></td>
        <td class="num ${o.shortfall > 0 ? 'bad' : 'ok'}">${o.shortfall}</td>
        <td>${o.fullySupplied ? '<span class="tag tag-ok">足额</span>' : '<span class="tag tag-cut">缺口</span>'}</td>
      </tr>`;
    })
    .join('');

  const bannerClass = result.totalShortfall > 0 ? 'warn' : 'success';
  const priorityText =
    result.priorityOutletCount > 0
      ? `第一级目标——重点出口总获配 <strong>${result.priorityAllocated}</strong> / 重点总需求
         ${result.priorityDemand}（重点缺口 ${result.priorityShortfall}，该值已是当前阀门状态与管容下的最大值）；`
      : '未选择重点出口（全部按普通处理），第一级目标值为 <strong>0</strong>；';
  const totalText =
    result.totalShortfall > 0
      ? `第二级目标——在不减少重点获配的前提下，全部出口总获配 <strong>${result.totalAllocated}</strong>
         / 总需求 ${result.totalDemand}，总缺口 <strong>${result.totalShortfall}</strong>。`
      : `第二级目标——全部出口总获配 <strong>${result.totalAllocated}</strong>，所有出口需求均已足额满足
         （总供给上限 ${result.totalSupplyCap}，总需求 ${result.totalDemand}）。`;

  priorityResultEl.innerHTML = `
    <div class="banner ${bannerClass}">
      ${priorityText}<br />${totalText}
    </div>
    <p class="hint">
      两级目标值：重点出口总获配 = <strong>${result.priorityAllocated}</strong>
      （普通出口获配合计 ${result.normalAllocated}）；全部出口总获配 = <strong>${result.totalAllocated}</strong>。
      第二阶段在第一阶段的残量网络上继续增广，可改派已有流量，不会逐出口占管造成虚假缺口。
    </p>
    <table>
      <thead>
        <tr><th>保供出口</th><th>类别</th><th>需求量</th><th>获配量</th><th>缺口</th><th>状态</th></tr>
      </thead>
      <tbody>${outletRows}</tbody>
    </table>
    <p class="hint">
      参与输水的管段（无阀管段 + 当前开启的带阀管段）共 ${result.activePipeCount} 条，每条容量为 1，
      同一无向管段双向合计只能占用一次，已关阀不参与。重点出口 ${result.priorityOutletCount} 个；
      未选重点出口时，这里的总获配量与「供水能力核验」完全一致，可直接对照。
    </p>`;
}

/** 渲染方案明细行（不改造 / 单条最优 / 两条最优），推荐方案所在行加标记。 */
function expansionPlanRow(
  label: string,
  plan: ExpansionPlan | null,
  recommended: ExpansionPlan
): string {
  if (!plan) {
    return `
      <tr>
        <td>${label}</td>
        <td class="hint">—（候选不足）</td>
        <td class="num">—</td>
        <td class="num">—</td>
      </tr>`;
  }
  const isRecommended =
    plan.upgraded.length === recommended.upgraded.length &&
    plan.upgraded.every((p, i) => p === recommended.upgraded[i]);
  const pipes =
    plan.upgraded.length > 0
      ? plan.upgraded.map((p) => `<code>${escapeHtml(p)}</code>`).join('、')
      : '<span class="hint">（不改造）</span>';
  return `
    <tr>
      <td>
        ${label}
        ${isRecommended ? '<span class="tag tag-ok">推荐</span>' : ''}
      </td>
      <td>${pipes}</td>
      <td class="num"><strong>${plan.totalAllocated}</strong></td>
      <td class="num ${plan.gain > 0 ? 'ok' : ''}">${plan.gain > 0 ? `+${plan.gain}` : '0'}</td>
    </tr>`;
}

function renderExpansion(result: ExpansionResult): void {
  if (result.status === 'invalid') {
    renderErrors(expansionResultEl, '输入有误，无法给出增容建议：', result.errors);
    return;
  }

  const rec = result.recommended;
  const recPipes =
    rec.upgraded.length > 0
      ? rec.upgraded.map((p) => `<code>${escapeHtml(p)}</code>`).join('、')
      : '（不改造）';
  const banner =
    rec.gain > 0
      ? `建议改造 <strong>${rec.upgraded.length}</strong> 条管段：${recPipes}（容量各由 1 提至 ${EXPANSION_TARGET_CAPACITY}）。
         总获配量由基线 <strong>${result.baseline}</strong> 提升至 <strong>${rec.totalAllocated}</strong>，
         增量 <strong>+${rec.gain}</strong>。`
      : `无需增容：不改造即达最高总获配量 <strong>${result.baseline}</strong>；
         改造任意单条或两条管段（容量由 1 提至 ${EXPANSION_TARGET_CAPACITY}）均无额外收益。`;
  const bannerClass = rec.gain > 0 ? 'success' : 'warn';

  const noUpgradePlan: ExpansionPlan = {
    upgraded: [],
    totalAllocated: result.baseline,
    gain: 0,
  };

  expansionResultEl.innerHTML = `
    <div class="banner ${bannerClass}">${banner}</div>
    <table>
      <thead>
        <tr><th>方案</th><th>改造管段编号</th><th>总获配量</th><th>相对基线增量</th></tr>
      </thead>
      <tbody>
        ${expansionPlanRow('不改造（基线）', noUpgradePlan, rec)}
        ${expansionPlanRow('单条改造最优', result.bestSingle, rec)}
        ${expansionPlanRow('两条组合改造最优', result.bestPair, rec)}
      </tbody>
    </table>
    <p class="hint">
      基线总获配量 <strong>${result.baseline}</strong>，推荐总获配量
      <strong>${rec.totalAllocated}</strong>，增量 <strong>+${rec.gain}</strong>；
      推荐管段编号：${recPipes}。
    </p>
    <p class="hint">
      候选管段为参与输水的不同管段（无阀管段 + 当前开启的带阀管段），共
      <strong>${result.activePipeCount}</strong> 条；已关阀及自环不可选。
      已枚举不改造、全部单条与全部两条组合（含「两条一起改造才产生收益」的情形），
      按总获配量最高、改造条数最少、管段编号（升序）列表字典序最小取舍。
      增容仅为方案测算，不会改写拓扑或已核验的供水能力结果。
    </p>`;
}

function renderValveRisk(result: ValveRiskResult): void {
  if (result.status === 'invalid') {
    renderErrors(valveRiskResultEl, '输入有误，无法扫描：', result.errors);
    return;
  }

  if (result.lossScenarios.length === 0) {
    valveRiskResultEl.innerHTML = `
      <div class="banner success">
        无有损场景：对全部 <strong>${result.openValveCount}</strong> 个当前开启阀门的
        <strong>${result.scenarioCount}</strong> 个单阀 / 两阀意外关闭场景逐一测算后，
        总获配量均不低于基线 <strong>${result.baselineAllocated}</strong>，新增缺口均为 0。
      </div>
      <p class="hint">
        参与输水的管段（无阀管段 + 当前开启的带阀管段）共 ${result.activePipeCount} 条；
        已关阀不参与扫描；模拟关闭不修改登记的阀门状态。
      </p>`;
    return;
  }

  const synergisticCount = result.lossScenarios.filter((s) => s.synergistic).length;
  const rows = result.lossScenarios
    .map((s) => {
      const kindTag =
        s.kind === 'single'
          ? '<span class="tag tag-normal">单阀</span>'
          : '<span class="tag tag-pipe">两阀</span>';
      const synTag = s.synergistic ? '<span class="tag tag-cut">协同失供</span>' : '';
      return `
        <tr>
          <td>${kindTag} ${synTag}</td>
          <td>${s.closedValves.map((v) => `<code>${escapeHtml(v)}</code>`).join('、')}</td>
          <td class="num"><strong>${result.baselineAllocated}</strong></td>
          <td class="num">${s.totalAllocated}</td>
          <td class="num bad"><strong>+${s.addedShortfall}</strong></td>
        </tr>`;
    })
    .join('');

  const banner =
    synergisticCount > 0
      ? `基线总获配 <strong>${result.baselineAllocated}</strong>；共模拟
         <strong>${result.scenarioCount}</strong> 个场景，其中
         <strong>${result.lossScenarios.length}</strong> 个有新增缺口，
         <strong>${synergisticCount}</strong> 个为协同失供
         （两阀新增缺口严格大于两个对应单阀新增缺口之和，需优先排查）。`
      : `基线总获配 <strong>${result.baselineAllocated}</strong>；共模拟
         <strong>${result.scenarioCount}</strong> 个场景，其中
         <strong>${result.lossScenarios.length}</strong> 个有新增缺口；
         未发现协同失供（两阀新增缺口均不超过对应两个单阀新增缺口之和）。`;

  valveRiskResultEl.innerHTML = `
    <div class="banner warn">${banner}</div>
    <table>
      <thead>
        <tr><th>场景</th><th>意外关闭的阀门</th><th>基线获配</th><th>场景获配</th><th>新增缺口</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="hint">
      扫描范围：当前开启的 <strong>${result.openValveCount}</strong> 个阀门
      （单阀 ${result.openValveCount} 个 + 两阀 ${
        result.scenarioCount - result.openValveCount
      } 个场景，上限 ${MAX_RISK_OPEN_VALVES} 个开启阀门）；
      参与输水的管段共 ${result.activePipeCount} 条，每条容量为 1，同一无向管段双向合计只能占用一次，已关阀不参与。
      结果按新增缺口降序、阀门编号列表字典序排列；仅模拟测算，<strong>不修改登记的阀门状态</strong>。
    </p>`;
}

function renderReopenPlan(result: ReopenResult): void {
  if (result.status === 'invalid') {
    renderErrors(reopenResultEl, '输入有误，无法规划：', result.errors);
    return;
  }
  if (result.status === 'empty') {
    reopenResultEl.innerHTML = `
      <div class="banner success">
        无需复水：当前没有登记为关闭的阀门，全部阀门均处于开启状态，无需规划开阀顺序。
      </div>
      <p class="hint">
        复水开阀顺序规划以登记为关闭的阀门为待开清单；待开清单为空时不产生任何开阀步骤。
      </p>`;
    return;
  }
  if (result.status === 'too-many') {
    reopenResultEl.innerHTML = `
      <div class="banner error">无法规划：待开阀门超过上限。</div>
      <p>${escapeHtml(result.reason)}</p>`;
    return;
  }

  const gain = result.finalAllocated - result.baselineAllocated;
  const stepRows = result.steps
    .map(
      (s) => `
      <tr>
        <td class="num">${s.step}</td>
        <td><code>${escapeHtml(s.valve)}</code></td>
        <td class="num"><strong>${s.totalAllocated}</strong></td>
        <td class="num">${s.cumulativeAllocated}</td>
      </tr>`
    )
    .join('');

  const bannerClass = gain > 0 ? 'success' : 'warn';
  const banner =
    gain > 0
      ? `基线总获配 <strong>${result.baselineAllocated}</strong>；按推荐顺序逐步开启
         ${result.closedValveCount} 个待开阀门后，总获配提升至 <strong>${result.finalAllocated}</strong>
         （净增 +${gain}），各步总获配之和（累计获配）<strong>${result.objective}</strong> 已达最大。`
      : `基线总获配 <strong>${result.baselineAllocated}</strong>；开完全部
         ${result.closedValveCount} 个待开阀门后总获配仍为 <strong>${result.finalAllocated}</strong>
         （净增 0：瓶颈在供给上限、出口需求或其他管段），
         各步总获配之和（累计获配）<strong>${result.objective}</strong> 已达最大。`;

  reopenResultEl.innerHTML = `
    <div class="banner ${bannerClass}">${banner}</div>
    <p class="hint">
      最终开阀顺序：${result.finalOrder.map((v) => `<code>${escapeHtml(v)}</code>`).join(' → ')}；
      同分按阀门编号序列字典序取最小。每步仅开启一个待开阀门，其余阀门保持登记状态不变。
    </p>
    <table>
      <thead>
        <tr><th>步骤</th><th>开启阀门</th><th>开阀后总获配</th><th>累计获配</th></tr>
      </thead>
      <tbody>
        <tr>
          <td class="num">0</td>
          <td class="hint">（基线：不开任何待开阀门）</td>
          <td class="num"><strong>${result.baselineAllocated}</strong></td>
          <td class="num">—</td>
        </tr>
        ${stepRows}
      </tbody>
    </table>
    <p class="hint">
      待开清单为当前登记为关闭的 ${result.closedValveCount} 个阀门（上限 ${MAX_REOPEN_VALVES} 个）；
      基线参与输水的管段（无阀管段 + 当前开启的带阀管段）共 ${result.activePipeCount} 条，每条容量为 1，
      同一无向管段双向合计只能占用一次，已关阀自其开启步骤起参与输水。
      规划仅为测算，<strong>不修改拓扑与登记的阀门状态</strong>。
    </p>`;
}

function renderAnomaly(result: AnomalyResult): void {
  if (result.status === 'invalid') {
    renderErrors(anomalyResultEl, '输入有误，无法定位：', result.errors);
    return;
  }
  if (result.status === 'no-match') {
    anomalyResultEl.innerHTML = `
      <div class="banner error">无匹配：${MAX_FLIPS} 处以内翻转无法解释现场观测。</div>
      <p>${escapeHtml(result.reason)}</p>
      <p class="hint">参与枚举的阀门数：${result.valveCount}（全部带阀管段，登记为开或关均可翻转）。</p>`;
    return;
  }

  const stateTag = (open: boolean): string =>
    open ? '<span class="tag tag-ok">开</span>' : '<span class="tag tag-cut">关</span>';
  /** 翻转描述，如「V08（开→关）」；id 已转义。 */
  const flipText = (sol: AnomalySolution): string =>
    sol.flipped
      .map((id) => {
        const row = sol.valveStates.find((v) => v.id === id)!;
        return `${escapeHtml(id)}（${row.registeredOpen ? '开' : '关'}→${row.actualOpen ? '开' : '关'}）`;
      })
      .join('、');

  const banner =
    result.minFlips === 0
      ? '登记状态与现场观测一致：<strong>0 处翻转</strong>即可解释全部观测，登记的阀门开闭状态无需修正。'
      : `找到 ${result.solutions.length}${result.truncated ? '+' : ''} 个匹配方案：
         最少需翻转 <strong>${result.minFlips}</strong> 处阀门状态。
         推荐方案（同数按阀门编号字典序最小）：翻转 ${flipText(result.solutions[0])}`;

  anomalyResultEl.innerHTML = `
    <div class="banner success">${banner}</div>
    <p class="hint">
      参与枚举的阀门数：${result.valveCount}（全部带阀管段，开、关状态均可翻转）；
      仅按已观测节点判定匹配，未观测节点的通水状态不参与；输入拓扑与登记开闭状态不会被修改。
    </p>
    ${result.solutions
      .map(
        (sol, i) => `
      <details class="solution" ${i === 0 ? 'open' : ''}>
        <summary>
          方案 ${i + 1}：翻转 ${sol.flipped.length} 处
          ${sol.flipped.length > 0 ? `（${flipText(sol)}）` : '（登记状态一致）'}
        </summary>
        <table>
          <thead>
            <tr><th>阀门</th><th>登记状态</th><th>翻转后状态</th><th>判定</th></tr>
          </thead>
          <tbody>
            ${sol.valveStates
              .map(
                (v) => `
              <tr>
                <td><code>${escapeHtml(v.id)}</code></td>
                <td>${stateTag(v.registeredOpen)}</td>
                <td>${stateTag(v.actualOpen)}</td>
                <td>${v.flipped ? '<span class="tag tag-low">已翻转</span>' : '<span class="hint">一致</span>'}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </details>`
      )
      .join('')}
    ${result.truncated ? '<p class="hint">匹配方案过多，仅展示前 100 个。</p>' : ''}`;
}

/** 假设的文字描述：登记状态 / 某阀门单独翻转（登记→实际）。 */
function observerHypothesisText(h: ObserverHypothesis): string {
  if (h.kind === 'baseline') return '登记状态（零翻转）';
  const from = h.registeredOpen ? '开' : '关';
  const to = h.actualOpen ? '开' : '关';
  return `翻转 ${h.flippedValve}（${from}→${to}）`;
}

function renderObserverPlan(result: ObserverPlanResult): void {
  if (result.status === 'invalid') {
    renderErrors(observerResultEl, '输入有误，无法规划：', result.errors);
    return;
  }

  const stateTag = (wet: boolean): string =>
    wet ? '<span class="tag tag-ok">有水</span>' : '<span class="tag tag-cut">无水</span>';
  const stateText = (wet: boolean): string => (wet ? '有水' : '无水');

  // 不可区分组表：组编号 / 组内假设 / 各候选点签名（推荐点加标记）
  const recommendedSet = new Set(result.recommendedPoints ?? []);
  const headerCells = result.candidates
    .map(
      (c) =>
        `<th${recommendedSet.has(c) ? ' class="recommended-col"' : ''}>${escapeHtml(c)}${
          recommendedSet.has(c) ? ' <span class="tag tag-pipe">推荐</span>' : ''
        }</th>`
    )
    .join('');
  const groupRows = result.groups
    .map((g, gi) => {
      const sigCells = g.signature
        .map(
          (wet, ci) =>
            `<td class="${recommendedSet.has(result.candidates[ci]) ? 'recommended-col' : ''}">${stateTag(wet)}</td>`
        )
        .join('');
      const hypList = g.hypotheses
        .map((h) => {
          const text = observerHypothesisText(h);
          return h.kind === 'baseline'
            ? `<li><strong>${escapeHtml(text)}</strong></li>`
            : `<li>${escapeHtml(text)}</li>`;
        })
        .join('');
      return `
        <tr>
          <td class="num"><strong>${gi + 1}</strong></td>
          <td><ul class="hyp-list">${hypList}</ul></td>
          ${sigCells}
        </tr>`;
    })
    .join('');

  if (!result.distinguishable) {
    observerResultEl.innerHTML = `
      <div class="banner warn">
        无法靠这些候选节点区分：${result.hypothesisCount} 个假设（登记状态 + 每个阀门单独翻转）
        在 ${result.candidates.length} 个候选节点上的有水 / 无水签名<strong>完全相同</strong>，
        全部归为 1 个不可区分组——仅观测这些节点无法判断是登记状态还是哪个阀门异常，
        请增设在不同假设下通水状态有差异的节点后再规划。
      </div>
      <p class="hint">
        参与枚举的阀门数：${result.valveCount}（开、关状态均可被单独翻转）；
        候选节点：${result.candidates.map((c) => `<code>${escapeHtml(c)}</code>`).join('、')}；
        求解不修改拓扑与登记的阀门状态。
      </p>
      <table>
        <thead>
          <tr><th>组</th><th>组内假设（不可区分）</th>${headerCells}</tr>
        </thead>
        <tbody>${groupRows}</tbody>
      </table>`;
    return;
  }

  const points = result.recommendedPoints!;
  // 各组在推荐观测点上的预期状态表
  const expectedHeader = points.map((p) => `<th>${escapeHtml(p)}</th>`).join('');
  const expectedRows = result.groups
    .map(
      (g, gi) => `
      <tr>
        <td class="num"><strong>${gi + 1}</strong></td>
        <td><ul class="hyp-list">${g.hypotheses.map((h) => `<li>${escapeHtml(observerHypothesisText(h))}</li>`).join('')}</ul></td>
        ${g.expectedStates.map((wet) => `<td>${stateTag(wet)}</td>`).join('')}
      </tr>`
    )
    .join('');

  observerResultEl.innerHTML = `
    <div class="banner success">
      ${result.hypothesisCount} 个假设在 ${result.candidates.length} 个候选节点上归为
      <strong>${result.groups.length}</strong> 个不可区分组；
      最少只需 <strong>${result.pointCount}</strong> 个观测点即可区分任意两组。
      推荐观测点（同数按节点名称升序列表字典序最小）：
      ${points.map((p) => `<code>${escapeHtml(p)}</code>`).join('、')}
    </div>
    <p class="hint">
      参与枚举的阀门数：${result.valveCount}（每个阀门单独翻转，开↔关）；假设总数 = 阀门数 + 1（含登记状态）。
      到推荐观测点观测后，将各点实际有水 / 无水状态与下表对照，落在哪个状态组合即对应哪个不可区分组。
      求解不修改拓扑与登记的阀门状态。
    </p>
    <h3>各组在推荐观测点的预期状态</h3>
    <table>
      <thead>
        <tr><th>组</th><th>组内假设（不可区分）</th>${expectedHeader}</tr>
      </thead>
      <tbody>${expectedRows}</tbody>
    </table>
    <details>
      <summary>全部候选节点上的有水 / 无水签名（${result.candidates.length} 个候选点，推荐点已标记）</summary>
      <table>
        <thead>
          <tr><th>组</th><th>组内假设（不可区分）</th>${headerCells}</tr>
        </thead>
        <tbody>${groupRows}</tbody>
      </table>
      <p class="hint">同一列上标记相同（同为${stateText(true)}或同为${stateText(false)}）的两个组无法靠该节点区分；
      推荐点集合保证任意两组在至少一个推荐点上的预期状态不同。</p>
    </details>`;
}

const ROUTE_SEGMENT_LABEL: Record<import('./solver').RouteSegmentKind, string> = {
  depart: '出发',
  between: '转场',
  return: '返程',
};

function renderClosureRoute(result: ClosureRouteResult): void {
  if (result.status === 'invalid') {
    renderErrors(closureRouteResultEl, '输入有误，无法规划关阀作业路线：', result.errors);
    return;
  }
  if (result.status === 'missing-map') {
    closureRouteResultEl.innerHTML = `
      <div class="banner error">映射缺失：存在未提供作业路点的必访阀门。</div>
      <p>${escapeHtml(result.reason)}</p>
      <p class="hint">缺失映射的阀门：${result.missingValves
        .map((v) => `<code>${escapeHtml(v)}</code>`)
        .join('、')}（共 ${result.missingValves.length} 个）。</p>`;
    return;
  }
  if (result.status === 'too-many') {
    closureRouteResultEl.innerHTML = `
      <div class="banner error">必访阀门超过上限，无法规划。</div>
      <p>${escapeHtml(result.reason)}</p>`;
    return;
  }
  if (result.status === 'unreachable') {
    closureRouteResultEl.innerHTML = `
      <div class="banner error">无路可达：无法完成「出发 → 全部必访阀门 → 返回」的完整路线。</div>
      <p>${escapeHtml(result.reason)}</p>
      <table>
        <thead>
          <tr><th>位置 A</th><th>位置 B</th></tr>
        </thead>
        <tbody>
          ${result.pairs
            .map(
              (p) => `
            <tr>
              <td>${escapeHtml(p.from)}</td>
              <td>${escapeHtml(p.to)}</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
      <p class="hint">请在作业通道 JSON 的 passages 中补全步行通道（minutes 为正整数）后再规划。</p>`;
    return;
  }

  if (result.requiredValveCount === 0) {
    closureRouteResultEl.innerHTML = `
      <div class="banner success">
        所选方案无需关闭任何阀门：不必安排关阀作业，从出发路点
        <code>${escapeHtml(result.start)}</code> 原地返回，总步行 <strong>0</strong> 分钟。
      </div>`;
    return;
  }

  const segmentRows = result.segments
    .map((seg) => {
      const tagClass = seg.kind === 'depart' ? 'tag-supply' : seg.kind === 'return' ? 'tag-normal' : 'tag-pipe';
      const action =
        seg.valve !== null
          ? `关闭 <code>${escapeHtml(seg.valve)}</code>（<span class="hint">${escapeHtml(result.valveWaypoints[seg.valve])}</span>）`
          : '<span class="hint">返回出发点</span>';
      return `
      <tr>
        <td><span class="tag ${tagClass}">${ROUTE_SEGMENT_LABEL[seg.kind]}</span></td>
        <td>${escapeHtml(seg.from)} → ${escapeHtml(seg.to)}</td>
        <td>${action}</td>
        <td>${seg.path.map((p) => escapeHtml(p)).join(' → ')}</td>
        <td class="num"><strong>${seg.minutesText}</strong></td>
      </tr>`;
    })
    .join('');

  closureRouteResultEl.innerHTML = `
    <div class="banner success">
      已选方案的 ${result.requiredValveCount} 个必访阀门全部可达；最优完整路线总步行
      <strong>${result.totalMinutesText}</strong> 分钟（从 <code>${escapeHtml(result.start)}</code> 出发并返回）。
      同耗时按关阀操作的阀门编号序列字典序取最小。
    </div>
    <h3>阀门操作顺序</h3>
    <p>
      ${result.valveOrder
        .map(
          (v, i) =>
            `<span class="op-step"><span class="op-no">${i + 1}</span> 关闭 <code>${escapeHtml(v)}</code>
             <span class="hint">（${escapeHtml(result.valveWaypoints[v])}）</span></span>`
        )
        .join('　')}
    </p>
    <h3>逐段实际通道路点与分段耗时</h3>
    <table>
      <thead>
        <tr><th>段落</th><th>起 → 止</th><th>本段操作</th><th>实际通行路点</th><th>步行分钟</th></tr>
      </thead>
      <tbody>${segmentRows}</tbody>
      <tfoot>
        <tr>
          <td colspan="4" class="num"><strong>总耗时</strong></td>
          <td class="num"><strong>${result.totalMinutesText}</strong></td>
        </tr>
      </tfoot>
    </table>
    <p class="hint">
      各段内部均取路点间最短通行距离（Floyd–Warshall），阀门访问顺序由子集动态规划求得，
      允许重复经过路点与通道；分段与总耗时全程按<strong>精确整数</strong>计算并以完整十进制展示，
      超大分钟（如接近 9007199254740991 的通道分钟）累加也不会舍入；
      路线测算<strong>不修改拓扑 JSON、阀门登记状态与作业通道输入</strong>。
    </p>`;
}

function renderEmergencyDelivery(result: EmergencyDeliveryResult): void {
  if (result.status === 'invalid') {
    renderErrors(deliveryResultEl, '输入有误，无法布点：', result.errors);
    return;
  }
  if (result.status === 'empty') {
    deliveryResultEl.innerHTML = `
      <div class="banner success">无需布点：全部出口缺口均为 0。</div>
      <p>${escapeHtml(result.reason)}</p>`;
    return;
  }

  // 逐出口分配明细（有缺口出口；byStation 列出每笔整数送水）
  const outletRows = result.rows
    .map((r) => {
      const detail =
        r.byStation.length > 0
          ? r.byStation
              .map(
                (a) =>
                  `<code>${escapeHtml(a.station)}</code> 送 <strong>${a.amount}</strong>` +
                  `<span class="hint">（步行 ${a.walkMinutes} 分钟）</span>`
              )
              .join('；')
          : '<span class="hint">（无站可送达）</span>';
      const stateTag =
        r.remaining === 0
          ? '<span class="tag tag-ok">已补齐</span>'
          : '<span class="tag tag-cut">未补齐</span>';
      return `
      <tr>
        <td>${escapeHtml(r.outlet)}<span class="hint">（取水口 ${escapeHtml(r.waypoint)}）</span></td>
        <td class="num">${r.need}</td>
        <td>${detail}</td>
        <td class="num"><strong>${r.delivered}</strong></td>
        <td class="num ${r.remaining > 0 ? 'bad' : 'ok'}">${r.remaining}</td>
        <td>${stateTag}</td>
      </tr>`;
    })
    .join('');

  if (result.status === 'unsolvable') {
    deliveryResultEl.innerHTML = `
      <div class="banner error">无解：全部候选站启用仍无法补齐全部缺口。</div>
      <p>${escapeHtml(result.reason)}</p>
      <p class="hint">
        待送水量合计 <strong>${result.totalNeed}</strong>；全部 ${result.stationCount} 个候选站启用时最多送出
        <strong>${result.totalDelivered}</strong>，仍缺 <strong>${result.totalNeed - result.totalDelivered}</strong>。
      </p>
      <table>
        <thead>
          <tr><th>保供出口（取水口）</th><th>待送水量</th><th>各站送水分配</th><th>实送</th><th>未补齐</th><th>状态</th></tr>
        </thead>
        <tbody>${outletRows}</tbody>
      </table>
      <p class="hint">
        未补齐出口：${result.uncoveredOutlets.map((o) => `<code>${escapeHtml(o)}</code>`).join('、')}。
        可服务关系按作业通道最短步行距离（≤ ${result.maxWalkMinutes} 分钟）建立；
        布点测算不修改原始管网及阀门状态。
      </p>`;
    return;
  }

  const stationRows = result.stations
    .map(
      (s) => `
      <tr>
        <td><code>${escapeHtml(s.name)}</code></td>
        <td class="num">${s.capacity}</td>
        <td class="num"><strong>${s.used}</strong></td>
        <td class="num">${s.capacity - s.used}</td>
        <td>${s.servedOutlets.length > 0 ? s.servedOutlets.map((o) => escapeHtml(o)).join('、') : '<span class="hint">—</span>'}</td>
      </tr>`
    )
    .join('');

  deliveryResultEl.innerHTML = `
    <div class="banner success">
      推荐布设 <strong>${result.stationUsed}</strong> 个应急送水站（候选 ${result.stationCount} 个中的最少站数，
      同数按站点名称升序列表字典序取最小）：
      ${result.stations.map((s) => `<code>${escapeHtml(s.name)}</code>`).join('、')}；
      总补齐量 <strong>${result.totalDelivered}</strong> / 待送水量 ${result.totalNeed}，全部缺口均已补齐。
    </div>
    <h3>逐出口整数送水分配</h3>
    <table>
      <thead>
        <tr><th>保供出口（取水口）</th><th>待送水量</th><th>各站送水分配</th><th>实送</th><th>未补齐</th><th>状态</th></tr>
      </thead>
      <tbody>${outletRows}</tbody>
    </table>
    <h3>各送水站用水情况（上限 / 已送 / 富余）</h3>
    <table>
      <thead>
        <tr><th>送水站（路点）</th><th>可送水量</th><th>已送出</th><th>富余</th><th>服务出口</th></tr>
      </thead>
      <tbody>${stationRows}</tbody>
    </table>
    <p class="hint">
      待送水量取自<strong>供水能力核验</strong>的各出口缺口（参与输水管段 ${result.activePipeCount} 条，与核验一致）；
      站到出口取水口按作业通道<strong>最短步行距离</strong>判定可服务（不超过 ${result.maxWalkMinutes} 分钟），
      送水量经<strong>容量流</strong>做整数分配。本结果仅为应急送水方案测算，
      <strong>不修改原始管网、阀门登记状态、供水能力数值与作业通道输入</strong>。
    </p>`;
}

/** 左闭右开区间格式化为 [from, to)；空清单返回占位文本。 */
function formatIntervals(intervals: { from: number; to: number }[]): string {
  if (intervals.length === 0) return '<span class="hint">—</span>';
  return intervals.map((iv) => `<code>[${iv.from}, ${iv.to})</code>`).join('、');
}

function renderValveAudit(result: ValveAuditResult): void {
  if (result.status === 'invalid') {
    renderErrors(valveAuditResultEl, '输入有误，无法审计：', result.errors);
    return;
  }

  const outletRows = result.outletRows
    .map((r) => {
      const cut = r.outageMinutes > 0;
      return `
      <tr>
        <td>${escapeHtml(r.outlet)}</td>
        <td>${formatIntervals(r.outageIntervals)}</td>
        <td class="num ${cut ? 'bad' : 'ok'}"><strong>${r.outageMinutes}</strong></td>
        <td>${cut ? '<span class="tag tag-cut">有断水</span>' : '<span class="tag tag-ok">全程未断</span>'}</td>
      </tr>`;
    })
    .join('');

  // 逐次原子变更明细：分钟 / 本次阀门操作（前→后开闭）/ 变更后漏点与各出口状态
  const changeRows = result.changes
    .map((ch) => {
      const ops = ch.operations
        .map((op) => {
          const fromTag = op.fromOpen ? '开' : '关';
          const toTag = op.toOpen ? '开' : '关';
          return `<code>${escapeHtml(op.valve)}</code>（${fromTag}→${toTag}）`;
        })
        .join('、');
      const outletState =
        result.outlets.length > 0
          ? ch.outletsConnected
              .map(
                (connected, i) =>
                  `${escapeHtml(result.outlets[i])}：${
                    connected
                      ? '<span class="tag tag-ok">通</span>'
                      : '<span class="tag tag-cut">断</span>'
                  }`
              )
              .join('　')
          : '<span class="hint">（无保供出口）</span>';
      return `
      <tr>
        <td class="num"><strong>${ch.minute}</strong></td>
        <td>${ops}</td>
        <td>${ch.leakPressurized ? '<span class="tag tag-cut">带压</span>' : '<span class="tag tag-ok">已隔离</span>'}</td>
        <td>${outletState}</td>
      </tr>`;
    })
    .join('');

  // 时间轴分段：每段标注漏点带压 / 已隔离与各出口通断（按时间排列）
  const segmentRows = result.segments
    .map((seg) => {
      const outlets =
        result.outlets.length > 0
          ? seg.outletsConnected
              .map(
                (connected, i) =>
                  `${escapeHtml(result.outlets[i])}：${
                    connected
                      ? '<span class="tag tag-ok">通</span>'
                      : '<span class="tag tag-cut">断</span>'
                  }`
              )
              .join('　')
          : '<span class="hint">（无保供出口）</span>';
      return `
      <tr>
        <td><code>[${seg.from}, ${seg.to})</code></td>
        <td class="num">${seg.to - seg.from}</td>
        <td>${seg.leakPressurized ? '<span class="tag tag-cut">漏点带压</span>' : '<span class="tag tag-ok">漏点已隔离</span>'}</td>
        <td>${outlets}</td>
        <td>${seg.changeMinute === null ? '<span class="hint">登记状态</span>' : `第 ${seg.changeMinute} 分钟变更后`}</td>
      </tr>`;
    })
    .join('');

  const leakText =
    result.leakPressurizedMinutes > 0
      ? `漏点在 <strong>${result.leakPressurizedMinutes}</strong> 分钟内仍连通供水点（带压），需重点核对隔离操作。`
      : '整个审计时段漏点均与全部供水点断开（带压 0 分钟）。';
  const outageText =
    result.totalOutageMinutes > 0
      ? `各出口断水分钟合计 <strong>${result.totalOutageMinutes}</strong>（逐出口累计见下表）。`
      : '整个审计时段各保供出口均未断水。';

  valveAuditResultEl.innerHTML = `
    <div class="banner ${result.leakPressurizedMinutes > 0 || result.totalOutageMinutes > 0 ? 'warn' : 'success'}">
      审计区间 <code>[${result.startMinute}, ${result.endMinute})</code>（共 ${result.totalMinutes} 分钟），
      实际操作记录 <strong>${result.recordCount}</strong> 条、原子变更 <strong>${result.changes.length}</strong> 次。
      ${leakText}<br />${outageText}
    </div>
    <h3>漏点带压时段（仍连通至少一个供水点，左闭右开、相邻已合并）</h3>
    <p>${formatIntervals(result.leakPressurizedIntervals)}
       <span class="hint">（累计 ${result.leakPressurizedMinutes} 分钟）</span></p>
    <h3>逐保供出口断水时段与累计断水分钟</h3>
    <table>
      <thead>
        <tr><th>保供出口</th><th>断水时段（无法连通任一供水点）</th><th>累计断水分钟</th><th>状态</th></tr>
      </thead>
      <tbody>${outletRows || '<tr><td colspan="4" class="hint">（未指定保供出口）</td></tr>'}</tbody>
    </table>
    <details open>
      <summary>逐次原子变更明细（${result.changes.length} 次）</summary>
      ${
        result.changes.length > 0
          ? `<table>
              <thead>
                <tr><th>分钟</th><th>本次原子变更（同分钟不同阀门同时生效）</th><th>变更后漏点</th><th>变更后各出口</th></tr>
              </thead>
              <tbody>${changeRows}</tbody>
            </table>`
          : '<p class="hint">空日志：整段按阀门登记状态覆盖，未发生任何变更。</p>'
      }
    </details>
    <details>
      <summary>回放时间轴分段（${result.segments.length} 段）</summary>
      <table>
        <thead>
          <tr><th>时段（左闭右开）</th><th>分钟数</th><th>漏点状态</th><th>各出口状态</th><th>状态来源</th></tr>
        </thead>
        <tbody>${segmentRows}</tbody>
      </table>
    </details>
    <p class="hint">
      每次变更后均按「无阀管段 + 开启阀门」重算供水点可达节点；同分钟对不同阀门的操作视为一次原子变更。
      审计为纯函数回放测算，<strong>不修改拓扑 JSON 与登记的阀门状态</strong>。
    </p>`;
}

function readNetwork(): import('./solver').Network {
  let raw: unknown;
  try {
    raw = JSON.parse(topologyEl.value);
  } catch (e) {
    throw { topologyErrors: [`拓扑 JSON 解析失败：${(e as Error).message}`] };
  }
  const { network, errors } = parseNetwork(raw);
  if (!network) throw { topologyErrors: errors };
  return network;
}

function readQuery(): { network: import('./solver').Network; query: Query } {
  const network = readNetwork();
  const query: Query = {
    supplies: splitList(suppliesEl.value),
    leak: leakEl.value.trim(),
    outlets: splitList(outletsEl.value),
  };
  return { network, query };
}

function run(): void {
  try {
    const { network, query } = readQuery();
    renderResult(solve(network, query), query);
  } catch (e) {
    renderCaughtError(resultEl, e);
  }
}

function runInspection(): void {
  try {
    const { network, query } = readQuery();
    renderInspection(inspectResilience(network, query));
  } catch (e) {
    renderCaughtError(inspectResultEl, e);
  }
}

function runCapacity(): void {
  try {
    const network = readNetwork();
    if (!capacityFormState) {
      renderErrors(capacityResultEl, '请先填写核验数值：', ['点击「按上方供水点 / 保供出口生成填写表」，为各点填写非负整数后再核验。']);
      return;
    }
    const { supplyCaps, outletDemands, errors: formErrors } = readCapacityNumbers();
    if (formErrors.length > 0) {
      renderErrors(capacityResultEl, '填写有误：', formErrors);
      return;
    }
    // 填写表可能与上方名单不一致（名单改动后未重新生成）：以填写表为准构建查询
    const capacityQuery: CapacityQuery = {
      supplies: capacityFormState.supplies,
      outlets: capacityFormState.outlets,
      supplyCaps,
      outletDemands,
    };
    renderCapacity(verifyCapacity(network, capacityQuery));
  } catch (e) {
    renderCaughtError(capacityResultEl, e);
  }
}

function runExpansion(): void {
  try {
    const network = readNetwork();
    if (!capacityFormState) {
      renderErrors(expansionResultEl, '请先填写核验数值：', ['点击「按上方供水点 / 保供出口生成填写表」，为各点填写非负整数后再生成增容建议。']);
      return;
    }
    const { supplyCaps, outletDemands, errors: formErrors } = readCapacityNumbers();
    if (formErrors.length > 0) {
      renderErrors(expansionResultEl, '填写有误：', formErrors);
      return;
    }
    // 与供水能力核验共用同一份拓扑、供给上限与出口需求输入（填写表为权威名单）
    const capacityQuery: CapacityQuery = {
      supplies: capacityFormState.supplies,
      outlets: capacityFormState.outlets,
      supplyCaps,
      outletDemands,
    };
    renderExpansion(suggestExpansion(network, capacityQuery));
  } catch (e) {
    renderCaughtError(expansionResultEl, e);
  }
}

function runValveRisk(): void {
  try {
    const network = readNetwork();
    if (!capacityFormState) {
      renderErrors(valveRiskResultEl, '请先填写核验数值：', ['点击「按上方供水点 / 保供出口生成填写表」，为各点填写非负整数后再扫描。']);
      return;
    }
    const { supplyCaps, outletDemands, errors: formErrors } = readCapacityNumbers();
    if (formErrors.length > 0) {
      renderErrors(valveRiskResultEl, '填写有误：', formErrors);
      return;
    }
    // 与供水能力核验共用同一份拓扑、供给上限与出口需求输入（填写表为权威名单）
    const capacityQuery: CapacityQuery = {
      supplies: capacityFormState.supplies,
      outlets: capacityFormState.outlets,
      supplyCaps,
      outletDemands,
    };
    renderValveRisk(scanValveClosureRisk(network, capacityQuery));
  } catch (e) {
    renderCaughtError(valveRiskResultEl, e);
  }
}

function runReopenPlan(): void {
  try {
    const network = readNetwork();
    if (!capacityFormState) {
      renderErrors(reopenResultEl, '请先填写核验数值：', ['点击「按上方供水点 / 保供出口生成填写表」，为各点填写非负整数后再规划。']);
      return;
    }
    const { supplyCaps, outletDemands, errors: formErrors } = readCapacityNumbers();
    if (formErrors.length > 0) {
      renderErrors(reopenResultEl, '填写有误：', formErrors);
      return;
    }
    // 与供水能力核验共用同一份拓扑、供给上限与出口需求输入（填写表为权威名单）
    const capacityQuery: CapacityQuery = {
      supplies: capacityFormState.supplies,
      outlets: capacityFormState.outlets,
      supplyCaps,
      outletDemands,
    };
    renderReopenPlan(planReopenSequence(network, capacityQuery));
  } catch (e) {
    renderCaughtError(reopenResultEl, e);
  }
}

function runPriorityCapacity(): void {
  try {
    const network = readNetwork();
    if (!capacityFormState) {
      renderErrors(priorityResultEl, '请先填写核验数值：', ['点击「按上方供水点 / 保供出口生成填写表」，为各点填写非负整数并选择重点出口后再优先配水。']);
      return;
    }
    const { supplyCaps, outletDemands, priorityOutlets, errors: formErrors } = readCapacityNumbers();
    if (formErrors.length > 0) {
      renderErrors(priorityResultEl, '填写有误：', formErrors);
      return;
    }
    // 填写表可能与上方名单不一致（名单改动后未重新生成）：以填写表为准构建查询
    const capacityQuery: CapacityQuery = {
      supplies: capacityFormState.supplies,
      outlets: capacityFormState.outlets,
      supplyCaps,
      outletDemands,
      priorityOutlets,
    };
    renderPriorityCapacity(verifyPriorityCapacity(network, capacityQuery));
  } catch (e) {
    renderCaughtError(priorityResultEl, e);
  }
}

function runAnomaly(): void {
  try {
    const network = readNetwork();
    // 异常定位沿用上方「供水点」，不依赖漏点与保供出口
    const anomalyQuery: AnomalyQuery = {
      supplies: splitList(suppliesEl.value),
      wetNodes: splitList(wetNodesEl.value),
      dryNodes: splitList(dryNodesEl.value),
    };
    renderAnomaly(locateValveAnomalies(network, anomalyQuery));
  } catch (e) {
    renderCaughtError(anomalyResultEl, e);
  }
}

function runObserverPlan(): void {
  try {
    const network = readNetwork();
    // 观测点规划沿用上方「供水点」，不依赖漏点与保供出口；不改拓扑
    const observerQuery: ObserverQuery = {
      supplies: splitList(suppliesEl.value),
      candidates: splitList(observerCandidatesEl.value),
    };
    renderObserverPlan(planSingleValveObservers(network, observerQuery));
  } catch (e) {
    renderCaughtError(observerResultEl, e);
  }
}

function runClosureRoute(): void {
  try {
    const network = readNetwork();
    if (selectedClosedValves === null) {
      renderErrors(closureRouteResultEl, '尚未选择关阀方案：', [
        '请先点击「搜索关阀方案」，再在「关阀方案搜索结果」中选择一个方案（默认已选推荐方案），然后再规划作业路线。',
      ]);
      return;
    }
    let rawPassage: unknown;
    try {
      rawPassage = JSON.parse(workPassageEl.value);
    } catch (e) {
      renderErrors(closureRouteResultEl, '作业通道 JSON 解析失败：', [(e as Error).message]);
      return;
    }
    const { passage, errors: passageErrors } = parseWorkPassage(rawPassage);
    if (!passage) {
      renderErrors(closureRouteResultEl, '作业通道 JSON 校验失败：', passageErrors);
      return;
    }
    renderClosureRoute(
      planClosureRoute({
        network,
        closedValves: selectedClosedValves,
        passage,
        start: routeStartEl.value.trim(),
      })
    );
  } catch (e) {
    renderCaughtError(closureRouteResultEl, e);
  }
}

function runDeliveryPlan(): void {
  try {
    const network = readNetwork();
    if (!capacityFormState) {
      renderErrors(deliveryResultEl, '请先填写核验数值：', [
        '点击「按上方供水点 / 保供出口生成填写表」，为各点填写非负整数后先做供水能力核验，再规划送水站布点。',
      ]);
      return;
    }
    if (!deliveryFormState) {
      renderErrors(deliveryResultEl, '请先生成候选站填写表：', [
        '填写候选站路点后点击「按候选站路点生成可送水量填写表」，再为各站填写可送水量。',
      ]);
      return;
    }
    const { supplyCaps, outletDemands, errors: capErrors } = readCapacityNumbers();
    if (capErrors.length > 0) {
      renderErrors(deliveryResultEl, '供水能力填写表有误：', capErrors);
      return;
    }
    const { caps: stationCaps, errors: stationErrors } = readDeliveryNumbers();
    if (stationErrors.length > 0) {
      renderErrors(deliveryResultEl, '候选站填写有误：', stationErrors);
      return;
    }
    const maxWalkText = deliveryMaxWalkEl.value.trim();
    if (maxWalkText === '' || !/^\d+$/.test(maxWalkText)) {
      renderErrors(deliveryResultEl, '填写有误：', ['最大步行分钟必须是非负整数。']);
      return;
    }
    const maxWalkMinutes = Number(maxWalkText);
    if (!Number.isSafeInteger(maxWalkMinutes)) {
      renderErrors(deliveryResultEl, '填写有误：', ['最大步行分钟数值过大。']);
      return;
    }
    let rawPassage: unknown;
    try {
      rawPassage = JSON.parse(workPassageEl.value);
    } catch (e) {
      renderErrors(deliveryResultEl, '作业通道 JSON 解析失败：', [(e as Error).message]);
      return;
    }
    const { passage, errors: passageErrors } = parseWorkPassage(rawPassage);
    if (!passage) {
      renderErrors(deliveryResultEl, '作业通道 JSON 校验失败：', passageErrors);
      return;
    }
    let outletWaypoints: unknown;
    try {
      outletWaypoints = JSON.parse(outletWaypointsEl.value);
    } catch (e) {
      renderErrors(deliveryResultEl, '出口到路点 JSON 解析失败：', [(e as Error).message]);
      return;
    }
    const stations = deliveryFormState.map((name) => ({ name, capacity: stationCaps[name] ?? 0 }));
    renderEmergencyDelivery(
      planEmergencyDeliveryStations(network, {
        // 与供水能力核验共用同一份拓扑、供给上限与出口需求输入（填写表为权威名单）
        supplies: capacityFormState.supplies,
        outlets: capacityFormState.outlets,
        supplyCaps,
        outletDemands,
        stations,
        maxWalkMinutes,
        outletWaypoints: outletWaypoints as Record<string, string>,
        passage,
      })
    );
  } catch (e) {
    renderCaughtError(deliveryResultEl, e);
  }
}

function runValveAudit(): void {
  try {
    const { network, query } = readQuery();
    const startText = auditStartEl.value.trim();
    const endText = auditEndEl.value.trim();
    const localErrors: string[] = [];
    if (!/^\d+$/.test(startText)) localErrors.push('起始分钟必须是非负整数。');
    if (!/^\d+$/.test(endText)) localErrors.push('结束分钟必须是非负整数。');
    const logText = valveAuditLogEl.value.trim();
    let records: unknown;
    if (logText === '') {
      records = []; // 空日志：整段按登记状态覆盖
    } else {
      try {
        records = JSON.parse(logText);
      } catch (e) {
        renderErrors(valveAuditResultEl, '操作记录 JSON 解析失败：', [(e as Error).message]);
        return;
      }
    }
    if (localErrors.length > 0) {
      renderErrors(valveAuditResultEl, '填写有误：', localErrors);
      return;
    }
    renderValveAudit(
      auditValveOperationWindow(network, {
        supplies: query.supplies,
        leak: query.leak,
        outlets: query.outlets,
        startMinute: Number(startText),
        endMinute: Number(endText),
        records: records as import('./solver').ValveOperationRecord[],
      })
    );
  } catch (e) {
    renderCaughtError(valveAuditResultEl, e);
  }
}

el<HTMLButtonElement>('#load-sample').addEventListener('click', () => {
  topologyEl.value = JSON.stringify(SAMPLE_NETWORK, null, 2);
  suppliesEl.value = SAMPLE_QUERY.supplies.join(', ');
  leakEl.value = SAMPLE_QUERY.leak;
  outletsEl.value = SAMPLE_QUERY.outlets.join(', ');
  wetNodesEl.value = SAMPLE_WET_NODES.join(', ');
  dryNodesEl.value = SAMPLE_DRY_NODES.join(', ');
  observerCandidatesEl.value = SAMPLE_OBSERVER_CANDIDATES.join(', ');
  workPassageEl.value = JSON.stringify(SAMPLE_WORK_PASSAGE, null, 2);
  routeStartEl.value = SAMPLE_ROUTE_START;
  deliveryStationsEl.value = SAMPLE_DELIVERY_STATIONS.join(', ');
  deliveryMaxWalkEl.value = String(SAMPLE_DELIVERY_MAX_WALK);
  outletWaypointsEl.value = JSON.stringify(SAMPLE_OUTLET_WAYPOINTS, null, 2);
  auditStartEl.value = String(SAMPLE_VALVE_AUDIT_START);
  auditEndEl.value = String(SAMPLE_VALVE_AUDIT_END);
  valveAuditLogEl.value = JSON.stringify(SAMPLE_VALVE_AUDIT_RECORDS, null, 2);
  buildCapacityForm(
    SAMPLE_QUERY.supplies,
    SAMPLE_QUERY.outlets,
    SAMPLE_SUPPLY_CAPS,
    SAMPLE_OUTLET_DEMANDS,
    new Set(SAMPLE_PRIORITY_OUTLETS)
  );
  buildDeliveryForm(SAMPLE_DELIVERY_STATIONS, SAMPLE_DELIVERY_CAPS);
  run();
  runInspection();
  runCapacity();
  runPriorityCapacity();
  runExpansion();
  runValveRisk();
  runAnomaly();
  runObserverPlan();
  runClosureRoute();
  runDeliveryPlan();
  runValveAudit();
});

el<HTMLButtonElement>('#solve').addEventListener('click', run);
el<HTMLButtonElement>('#inspect').addEventListener('click', runInspection);
el<HTMLButtonElement>('#verify-capacity').addEventListener('click', runCapacity);
el<HTMLButtonElement>('#priority-capacity').addEventListener('click', runPriorityCapacity);
el<HTMLButtonElement>('#suggest-expansion').addEventListener('click', runExpansion);
el<HTMLButtonElement>('#scan-valve-risk').addEventListener('click', runValveRisk);
el<HTMLButtonElement>('#plan-reopen').addEventListener('click', runReopenPlan);
el<HTMLButtonElement>('#locate-anomaly').addEventListener('click', runAnomaly);
el<HTMLButtonElement>('#plan-observers').addEventListener('click', runObserverPlan);
el<HTMLButtonElement>('#plan-closure-route').addEventListener('click', runClosureRoute);
el<HTMLButtonElement>('#plan-delivery').addEventListener('click', runDeliveryPlan);
el<HTMLButtonElement>('#run-valve-audit').addEventListener('click', runValveAudit);
el<HTMLButtonElement>('#build-delivery-form').addEventListener('click', () => {
  const stations = [...new Set(splitList(deliveryStationsEl.value))];
  if (stations.length > MAX_DELIVERY_STATIONS) {
    renderErrors(deliveryResultEl, '候选站过多：', [
      `候选送水站有 ${stations.length} 个，超过上限 ${MAX_DELIVERY_STATIONS} 个；请精简候选名单后再生成填写表。`,
    ]);
    return;
  }
  // 重新生成时保留同名站已填数值
  const prev = readDeliveryNumbers();
  buildDeliveryForm(stations, prev.caps);
});
// 关阀方案结果区「选择该方案用于作业路线」按钮（事件委托）
resultEl.addEventListener('click', (ev) => {
  const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('.select-solution-btn');
  if (!btn) return;
  const index = Number(btn.dataset.solutionIndex);
  if (!Number.isInteger(index)) return;
  selectSolution(index);
  // 就地刷新各方案按钮的选中态，保留各方案的展开 / 折叠状态
  resultEl.querySelectorAll<HTMLButtonElement>('.select-solution-btn').forEach((b) => {
    const selected = b === btn;
    b.classList.toggle('selected', selected);
    b.textContent = selected ? '✓ 已选为作业路线方案' : '选择该方案用于作业路线';
  });
});
el<HTMLButtonElement>('#build-capacity-form').addEventListener('click', () => {
  try {
    readNetwork(); // 仅校验拓扑 JSON，核验不依赖漏点
  } catch (e) {
    renderCaughtError(capacityResultEl, e);
    return;
  }
  const supplies = [...new Set(splitList(suppliesEl.value))];
  const outlets = [...new Set(splitList(outletsEl.value))];
  if (supplies.length === 0 || outlets.length === 0) {
    renderErrors(capacityResultEl, '无法生成填写表：', [
      ...(supplies.length === 0 ? ['请先在上方填写至少一个供水点。'] : []),
      ...(outlets.length === 0 ? ['请先在上方填写至少一个保供出口。'] : []),
    ]);
  }
  // 重新生成时尽量保留同节点已填数值与重点选择
  const prev = readCapacityNumbers();
  buildCapacityForm(supplies, outlets, prev.supplyCaps, prev.outletDemands, new Set(prev.priorityOutlets));
});
