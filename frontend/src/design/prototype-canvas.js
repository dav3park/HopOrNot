// Adapted directly from dav3park/HopOrNot design/seat-probability-view.
// Branch layout coordinates and SVGs are retained; Flame tokens and shorter copy are applied.
// See design-reference/README.md for source attribution and data-only changes.
import { Component, Fragment } from 'react';
import { AppState } from 'react-native';
import htm from 'htm';
import { nativeH as h } from './native-renderer';
import { probabilities, timeInSeoul } from '../domain/logic';
var html = htm.bind(h);
var SP = 110, C = 195, HALF = 195 / 110;
var FB = 788, FT = 462, SX0 = 146, SXW = 228;
var BOUNCE = 'cubic-bezier(.34,1.56,.64,1)';
var TX = 195, TY = 403.5, PS = 1.98;
var MIN_PER_STOP = 2, WALK_PER_STOP = 4, TH = 0.7, CAP = 45, LOAD = 1.9;
var LEVELS = [1, 5, 10];
var DAYS = ['일', '월', '화', '수', '목', '금', '토'];
var INIT = [0.92, 0.72, 0.47, 0.33, 0.19, 0.05];
var FULL = [0.6, 0.5, 0.95, 0.9, 0.42, 0.2];
var ROUTES = {
  '5100': { kind: '직행좌석', color: '#EC0000', soft: '#FBF1EA', trail: 'rgba(236,0,0,0.45)', stops: ['경희대학교', '경희대정문', '서천동', '기흥역', '신갈오거리', '신갈IC', '양재IC', '양재역', '뱅뱅사거리', '강남역'] },
  'M5107': { kind: '광역급행 M', color: '#EC0000', soft: '#FBF1EA', trail: 'rgba(236,0,0,0.45)', stops: ['경희대학교', '경희대정문', '영통역', '청명역', '기흥IC입구', '서울역버스환승센터', '숭례문', '서울역'] },
  '1112': { kind: '직행좌석', color: '#EC0000', soft: '#FBF1EA', trail: 'rgba(236,0,0,0.45)', stops: ['경희대학교', '경희대정문', '영통역', '신갈오거리', '수지구청', '판교IC', '잠실역', '잠실대교남단', '강변역'] }
};
var SELECT_ROUTES = [
  { no: '5100', running: 4, eta: '3분', seats: 14, advice: '1대 보내면 도착 시 1석 이상 82%' },
  { no: 'M5107', running: 3, eta: '7분', seats: 22, advice: '이번 버스 도착 시 1석 이상 76%' },
  { no: '1112', running: 2, eta: '12분', seats: 6, advice: '2대 보내면 도착 시 1석 이상 71%' }
];
function isInt(p) { return Math.abs(p - Math.round(p)) < 1e-6; }
function bub(d) { return 1 + 0.45 * Math.exp(-d * d * 1.6); }
function makeBuses(n, records = [], stations = [], mode = 'mock', target) {
  return records.slice().sort((a,b) => a.arrivalOrder - b.arrivalOrder).slice(0,3).map((record,i) => ({ id: record.vehicleId, gen: 0, pos: mode === 'mock' ? Math.max(0, stations.findIndex(s => s.stationId === target?.stationId && s.sequence === target?.stationSequence) - [1.75,2.75,3.75][i]) : 0, dwell:1, jump:false, record, stations, target, knownPosition: mode === 'mock' }));
}
function defMy(n) { return Math.round((n - 1) * 0.55); }
function ordinal(r) { return r === 0 ? '이번' : r === 1 ? '다음' : (r + 1) + '번째'; }
function seatsAt(b, i) { return Math.abs(i-b.pos)<1e-6 ? b.record?.currentObservation?.remainingSeats ?? null : null; }
function seatText(n) { return n === null || n === undefined || n < 0 ? '정보 없음' : n + '석'; }
function prob(b, i, span, k) {
  const station = b.stations?.[i];
  const d = station && b.target?.stationId === station.stationId && b.target?.stationSequence === station.sequence ? b.record?.distribution : b.record?.stationPredictions?.find(p => p.stationId === station?.stationId && p.stationSequence === station?.sequence)?.distribution;
  try { const v = probabilities(d ?? null); return v ? v[[1,5,10].indexOf(k)] : null; } catch { return -1; }
}
function pct(p) { return p === null || p === undefined ? '—' : p < 0 ? '오류' : Math.round(p * 100) + '%'; }
function fillOf(p) { if(p===null || p<0)return '#E9E9E9'; return p >= 0.7 ? '#EC0000' : p >= 0.4 ? '#EA6F5D' : '#F5DECF'; }
function textOf(p) { if(p===null || p<0)return '#696969'; return p >= 0.7 ? '#EC0000' : p >= 0.4 ? '#990000' : '#990000'; }
function tabStyle(on) { return 'min-height: 30px; border: 0; border-radius: 8px; font-size: 14px; cursor: pointer; ' + (on ? 'background: #FFFFFF; color: #000000; font-weight: 700; box-shadow: 0 1px 3px rgba(0,0,0,0.12);' : 'background: transparent; color: #696969; font-weight: 500;'); }
function cellOf(p) { if(p===null || p<0)return 'background: #E9E9E9; color: #696969;'; return p >= 0.7 ? 'background: #EC0000; color: #FFFFFF;' : p >= 0.4 ? 'background: #DEEDF2; color: #000000;' : 'background: #FBF1EA; color: #990000;'; }

var BUS_TOP = function (color) {
  return html`<svg width="30" height="44" viewBox="0 0 30 44" aria-hidden="true"><rect x="0" y="5" width="4" height="3" rx="1" fill="#000000"></rect><rect x="26" y="5" width="4" height="3" rx="1" fill="#000000"></rect><rect x="3" y="1" width="24" height="42" rx="6" fill=${color}></rect><rect x="6" y="3.5" width="18" height="7" rx="2.5" fill="#FFFFFF" opacity="0.92"></rect><rect x="7" y="14" width="16" height="21" rx="2" fill="#000000" opacity="0.14"></rect><rect x="11" y="18" width="8" height="5" rx="1" fill="#FFFFFF" opacity="0.4"></rect><rect x="8" y="38.5" width="14" height="2.5" rx="1.2" fill="#FFFFFF" opacity="0.55"></rect></svg>`;
};
var BUS_SIDE = function (color, w, hgt, fill2) {
  return html`<svg width=${w} height=${hgt} viewBox="0 0 52 36" aria-hidden="true"><rect x="1" y="2" width="50" height="26" rx="7" fill=${color}></rect><rect x="6" y="7" width="9" height="9" rx="2" fill="#FFFFFF" opacity="0.92"></rect><rect x="18" y="7" width="9" height="9" rx="2" fill="#FFFFFF" opacity="0.92"></rect><rect x="30" y="7" width="9" height="9" rx="2" fill="#FFFFFF" opacity="0.92"></rect><rect x="42" y="7" width="6" height="14" rx="2" fill="#FFFFFF" opacity="0.92"></rect><circle cx="13" cy="29" r="5" fill=${fill2 || '#000000'}></circle><circle cx="39" cy="29" r="5" fill=${fill2 || '#000000'}></circle></svg>`;
};
var CHEVRON = html`<svg width="12" height="20" viewBox="0 0 12 20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="10,2 2,10 10,18"></polyline></svg>`;



export class PrototypeCanvas extends Component {
  constructor(props) {
    super(props);
    var n = props.routeViews[props.route].stops.length;
    this.state = { screen: props.initialScreen || 'loading', route: props.route, buses: makeBuses(n, props.vehicles, props.stations, props.mode, props.selection), myStop: props.stationIndex ?? defMy(n), phase: 'strings', stage: 0, tracked: null, fromX: 0, fromY: 0, pan: 0, dragging: false, view: 'now', need: 1, histMode: 'today' };
    this.drag = null;
    this.timers = [];
    var self = this;
    this.down = function (e) { if (self.state.phase !== 'line') return; self.drag = { x: e.clientX, pan: self.clampPan(self.state.pan) }; try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {} self.setState({ dragging: true }); };
    this.move = function (e) { if (!self.drag) return; self.setState({ pan: self.clampPan(self.drag.pan + (e.clientX - self.drag.x) / self.props.scale) }); };
    this.up = function () { self.drag = null; self.setState({ dragging: false }); };
    this.goBus = function () { self.setState({ pan: 0 }); };
    this.goStart = function () { self.setState({ pan: self.trackedPos() * SP }); };
    this.goEnd = function () { self.setState({ pan: (self.trackedPos() - (self.count() - 1)) * SP }); };
    this.backToStrings = function () { self.clearTimers(); self.setState({ phase: 'strings', stage: 0, pan: 0 }); };
    this.backToSelect = function () { self.clearTimers(); self.setState({ screen: 'select', phase: 'strings', stage: 0, pan: 0, view: 'now' }); };
    this.skipLoading = function () { self.setState({ screen: 'select' }); };
  }
  componentDidUpdate(previous, previousState) {
    if (previous.vehicles !== this.props.vehicles || previous.stations !== this.props.stations || previous.route !== this.props.route) {
      const n = this.props.stations.length;
      this.setState({ route: this.props.route, buses: makeBuses(n, this.props.vehicles, this.props.stations, this.props.mode, this.props.selection), myStop: this.props.stationIndex ?? defMy(n), phase: 'strings', stage: 0 });
    }
    if(previousState.myStop !== this.state.myStop) this.props.onStation?.(this.state.myStop);
    if(previousState.view !== this.state.view || previousState.histMode !== this.state.histMode) this.props.onHistory?.(this.state.view === 'history', this.state.histMode);
    if(previousState.screen !== this.state.screen) this.props.onScreen?.(this.state.screen);
  }
  handleBack() {
    if(this.state.phase !== 'strings'){ this.backToStrings(); return true; }
    if(this.state.screen === 'live'){this.backToSelect();return true;}
    return false;
  }
  openRoute(no) {
    this.props.onRoute?.(no);
    var nn = this.props.routeViews[no].stops.length;
    this.clearTimers();
    this.setState({ screen: 'live', route: no, buses: makeBuses(nn, no === this.props.route ? this.props.vehicles : [], this.props.stations, this.props.mode, this.props.selection), myStop: defMy(nn), phase: 'strings', stage: 0, tracked: null, pan: 0, view: 'now' });
  }
  count() { return this.props.routeViews[this.state.route].stops.length; }
  trackedBus() { var id = this.state.tracked, bs = this.state.buses; for (var i = 0; i < bs.length; i++) if (bs[i].id === id) return bs[i]; return bs[0] || { id: "unavailable", pos:0, record:null }; }
  trackedPos() { return Math.min(this.trackedBus().pos, this.count() - 1); }
  clampPan(p) { var n = this.count(), pos = this.trackedPos(); return Math.min(pos * SP, Math.max((pos - (n - 1)) * SP, p)); }
  clearTimers() { this.timers.forEach(function (t) { clearTimeout(t); }); this.timers = []; }
  componentDidMount() {
    var self = this;
    this.timer = setInterval(function () { self.tick(); }, 3000);
    this.loadTimer = setTimeout(function () { if (self.state.screen === 'loading') self.setState({ screen: 'select' }); }, 2400);
  }
  componentWillUnmount() { clearInterval(this.timer); clearTimeout(this.loadTimer); this.clearTimers(); }
  tick() {
    if(this.props.mode !== 'mock' || AppState.currentState !== 'active') return;
    var n = this.count(), tid = this.state.tracked, lost = false, selfTarget = this.state.myStop;
    var buses = this.state.buses.map(function (b) {
      var o = { ...b, id: b.id, gen: b.gen, pos: b.pos, dwell: b.dwell, jump: false };
      if (o.pos >= selfTarget) return o;
      if (o.dwell > 0) { o.dwell -= 1; return o; }
      if (o.pos >= n - 1 - 1e-6) { o.pos = 0; o.dwell = 2; o.jump = true; o.gen += 1; if (o.id === tid) lost = true; return o; }
      var np = Math.min(selfTarget, o.pos + 0.25), ni = Math.floor(o.pos + 1e-6) + 1;
      if (np >= ni - 1e-6) { np = ni; o.dwell = ((o.id * 3 + ni) % 3 === 0) ? 2 : 1; }
      o.pos = np;
      return o;
    });
    var patch = { buses: buses };
    if (lost && this.state.phase === 'line') { patch.phase = 'strings'; patch.pan = 0; }
    this.setState(patch);
  }
  pickBus(id, x, y) {
    var self = this;
    if (this.state.phase !== 'strings') return;
    this.clearTimers();
    this.setState({ phase: 'fly', stage: 0, tracked: id, fromX: x, fromY: y, pan: 0 });
    this.timers.push(setTimeout(function () { self.setState({ stage: 1 }); }, 40));
    this.timers.push(setTimeout(function () { self.setState({ stage: 2 }); }, 680));
    this.timers.push(setTimeout(function () { self.setState({ phase: 'line', stage: 0 }); }, 980));
  }
  vals() {
    var self = this, st = this.state, key = st.route, R = this.props.routeViews[key];
    var stops = R.stops, n = stops.length, span = n - 1, accent = R.color;
    var my = Math.min(st.myStop, span), phase = st.phase, need = st.need;
    var buses = st.buses;

    var coming = buses.filter(function (b) { return !b.knownPosition || b.pos <= my + 1e-6; }).sort(function (a, b) { return b.pos - a.pos; });
    var rankOf = {};
    coming.forEach(function (b, r) { rankOf[b.id] = r; });
    var cnt = coming.length;
    var sx = function (r) { return SX0 + (r + 0.5) * SXW / Math.max(cnt, 1); };
    var colW = Math.min(58, SXW / Math.max(cnt, 1) - 2);
    var gap = (FB - FT) / span;
    var fy = function (p) { return FB - p * gap; };
    var etaMin = function (b, stop) { return (stop - b.pos) * MIN_PER_STOP; };
    var etaOf = function (b) { if(!b.record?.etaAt)return 'ETA 없음'; var minutes=Math.max(0,Math.ceil((Date.parse(b.record.etaAt)-Date.parse(self.props.now))/60000)); return (b.record.etaSource === 'ESTIMATED' ? '예상 ' : '') + minutes + '분'; };

    var waitR = -1, bestR = -1, bestP = -1;
    coming.forEach(function (b, r) { var p = prob(b, my, span, need); if (waitR < 0 && p >= TH) waitR = r; if (p > bestP) { bestP = p; bestR = r; } });
    var waitHead, waitSub, waitP;
    if (waitR >= 0) {
      var wb = coming[waitR]; waitP = prob(wb, my, span, need);
      waitHead = ordinal(waitR) + ' 버스';
      var wMin = Math.ceil(etaMin(wb, my));
      waitSub = '지금 ' + seatText(seatsAt(wb, wb.pos, span)) + ' · ' + etaOf(wb);
    } else if (cnt > 0) {
      waitP = bestP; waitHead = '70% 이상 없음'; waitSub = '대기 인원 미반영';
    } else { waitP = 0; waitHead = '오는 버스 없음'; waitSub = '잠시 후 다시 예측'; }

    var mv = null;
    var moveText = this.props.alternativeText || '대안 정류장';

    var frets = stops.map(function (name, i) {
      var isMy = i === my, above = i > my, isMove = !!mv && mv.j === i;
      return {
        name: name, isMy: isMy, isMove: isMove, aria: name + ' 내 정류장으로 설정',
        pick: function () { self.setState({ myStop: i }); },
        lineStyle: 'position: absolute; left: 140px; width: 236px; top: ' + (fy(i) - (isMy ? 1.5 : 0.5)) + 'px; height: ' + (isMy ? 3 : 1) + 'px; background: ' + (isMy ? accent : isMove ? '#000000' : '#E9E9E9') + ';',
        btnStyle: 'position: absolute; left: 8px; top: ' + (fy(i) - Math.min(42, gap) / 2) + 'px; width: 130px; height: ' + Math.min(42, gap) + 'px; padding: 0 8px; border: 0; background: transparent; cursor: pointer; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 2px; text-align: left;',
        nameStyle: 'font-size: 13px; line-height: 16px; max-width: 114px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; ' + (isMy ? 'font-weight: 700; color: ' + accent + ';' : isMove ? 'font-weight: 700; color: #000000;' : above ? 'font-weight: 500; color: #696969;' : 'font-weight: 600; color: #000000;')
      };
    });

    var strings = coming.map(function (b, r) {
      var x = sx(r), rec = r === waitR, cw = colW - 4;
      return {
        id: b.id, label: (rec ? '추천' : ordinal(r)) + (b.record?.etaSource === 'ESTIMATED' ? ' 예상' : ''), rec: rec, eta: etaOf(b).replace('예상 ', ''), seats: seatText(seatsAt(b, b.pos, span)),
        cells: LEVELS.map(function (k, li) {
          var p = prob(b, my, span, k);
          return { k: k, pct: pct(p), style: 'position: absolute; top: ' + (383 + li * 22) + 'px; left: ' + (x - cw / 2) + 'px; width: ' + cw + 'px; height: 20px; border-radius: 5px; display: flex; align-items: center; justify-content: center; font-size: 11.5px; font-weight: 700; font-variant-numeric: tabular-nums; transition: left .45s ease, width .45s ease; ' + cellOf(p) };
        }),
        headStyle: 'position: absolute; top: 318px; left: ' + (x - colW / 2) + 'px; width: ' + colW + 'px; height: 34px; display: flex; flex-direction: column; align-items: center; justify-content: center; transition: left .45s ease, width .45s ease;',
        seatStyle: 'position: absolute; top: 354px; left: ' + (x - colW / 2) + 'px; width: ' + colW + 'px; height: 24px; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; color: #FFFFFF; font-variant-numeric: tabular-nums; transition: left .45s ease, width .45s ease;',
        recStyle: 'position: absolute; top: 315px; left: ' + (x - colW / 2 - 1) + 'px; width: ' + (colW + 2) + 'px; height: 137px; box-sizing: border-box; border: 2px solid #EC0000; border-radius: 10px; pointer-events: none; transition: left .45s ease, width .45s ease;',
        highStyle: 'position: absolute; top: ' + (FT - 8) + 'px; height: ' + Math.max(0, fy(my) - FT + 8) + 'px; left: ' + (x - 0.5) + 'px; width: 1px; background: #E9E9E9; transition: left .45s ease;',
        lowStyle: 'position: absolute; top: ' + fy(my) + 'px; height: ' + (FB + 12 - fy(my)) + 'px; left: ' + (x - 1) + 'px; width: 2px; background: #AEAEB2; transition: left .45s ease;'
      };
    });

    var nodes = [];
    coming.forEach(function (b, r) {
      var x = sx(r);
      for (var i = Math.ceil(b.pos - 1e-6); i <= my; i++) {
        var p = prob(b, i, span, need), s = i === my ? 14 : 10;
        nodes.push({ key: b.id + '-' + i, style: 'position: absolute; left: ' + (x - s / 2) + 'px; top: ' + (fy(i) - s / 2) + 'px; width: ' + s + 'px; height: ' + s + 'px; border-radius: ' + s + 'px; background: ' + fillOf(p) + '; box-shadow: 0 0 0 2px #FFFFFF; transition: left .45s ease;' });
      }
    });
    var marks = [];
    var markAt = function (k, r, i, color) {
      var x = sx(r), y = fy(i);
      marks.push({ key: k, style: 'position: absolute; left: ' + (x - 11) + 'px; top: ' + (y - 11) + 'px; width: 22px; height: 22px; border-radius: 11px; border: 2px solid ' + color + '; box-sizing: border-box; pointer-events: none;' });
    };
    if (waitR >= 0) markAt('wait', waitR, my, '#EC0000');
    if (mv) markAt('move', mv.r, mv.j, '#000000');

    var fleet = buses.map(function (b) {
      var r = rankOf[b.id], vis = r !== undefined && b.knownPosition;
      var x = sx(vis ? r : Math.max(cnt - 1, 0)), y = fy(Math.min(b.pos, span));
      var hideForFly = st.tracked === b.id && phase !== 'strings';
      var stopped = isInt(b.pos);
      return {
        id: b.id, color: accent, trail: R.trail, stopped: stopped, seats: seatsAt(b, Math.min(b.pos, span), span) !== null && seatsAt(b, Math.min(b.pos, span), span) >= 0 ? seatsAt(b, Math.min(b.pos, span), span) : '?',
        aria: (vis ? ordinal(r) + ' 버스, 지금 ' + seatText(seatsAt(b, b.pos, span)) + ', 내 정류장 도착 시 ' + need + '석 이상 남을 확률 ' + pct(prob(b, my, span, need)) : '버스') + ', 실시간 노선 보기',
        pick: function () { self.pickBus(b.id, x, y); },
        style: 'position: absolute; left: ' + (x - 22) + 'px; top: ' + (y - 22) + 'px; width: 44px; height: 44px; padding: 0; border: 0; background: transparent; cursor: pointer; opacity: ' + (vis && !hideForFly ? 1 : 0) + '; pointer-events: ' + (vis ? 'auto' : 'none') + '; transition: ' + (b.jump ? 'opacity .6s ease' : 'left .45s ease, top 3s linear, opacity .4s ease') + ';'
      };
    });

    var tabs = ['5100', 'M5107', '1112'].map(function (no) {
      var on = no === key;
      return {
        no: no, pick: function () { self.openRoute(no); },
        style: tabStyle(on)
      };
    });
    var views = [['now', '도착 예측'], ['history', '지난 기록']].map(function (t) {
      return { id: t[0], label: t[1], pick: function () { self.setState({ view: t[0] }); }, style: tabStyle(st.view === t[0]) };
    });
    var levels = LEVELS.map(function (k, li) {
      var on = k === need;
      return {
        k: k, on: on, pick: function () { self.setState({ need: k }); },
        style: 'position: absolute; left: 74px; width: 308px; top: ' + (382 + li * 22) + 'px; height: 22px; padding: 0 0 0 6px; border: 0; border-radius: 6px; background: transparent; cursor: pointer; text-align: left; font-size: 11px; color: #000000; font-weight: ' + (on ? 800 : 500) + '; box-shadow: ' + (on ? 'inset 0 0 0 1.5px #EC0000' : 'none') + ';'
      };
    });
    var histMode = st.histMode;
    var histRows = (this.props.historyRecords || []).map(r => ({time: timeInSeoul(r.observedAt), seats: r.remainingSeats, near: false}));
    var histFull = histRows.filter(function (h) { return h.seats === 0; }).length;
    var knownHistory = histRows.filter(h => h.seats !== null && h.seats >= 0); var histAvg = knownHistory.length ? Math.round(knownHistory.reduce((a,h) => a+h.seats,0)/knownHistory.length) : '—';
    var histFive = histRows.filter(function (h) { return h.seats >= 5; }).length;
    var histTabs = [['today', '오늘'], ['week', '지난주 ' + DAYS[new Date(this.props.now).getDay()] + '요일']].map(function (t) {
      return { id: t[0], label: t[1], pick: function () { self.setState({ histMode: t[0] }); }, style: tabStyle(histMode === t[0]) };
    });

    var tb = this.trackedBus();
    var pos = Math.min(tb.pos, span);
    var pan = this.clampPan(st.pan);
    var vc = pos - pan / SP;
    var atStop = isInt(pos), cur = Math.round(pos);
    var nextIdx = atStop ? Math.min(cur + 1, span) : Math.ceil(pos);
    var atEnd = atStop && cur === span;
    var mins = Math.max(1, Math.ceil((nextIdx - pos) * MIN_PER_STOP));
    var trackedRank = rankOf[tb.id];
    var toMy = my - pos;
    var tSeats = seatsAt(tb, pos, span);
    var trackProbs = LEVELS.map(function (k) { var p = prob(tb, my, span, k); return { k: k, pct: pct(p), style: 'font-size: 19px; font-weight: 700; letter-spacing: -0.3px; font-variant-numeric: tabular-nums; color: ' + textOf(p) + ';' }; });
    var myLine = toMy > 1e-6 ? '내 정류장까지 ' + Math.ceil(toMy - 1e-6) + '정거장 · 약 ' + Math.ceil(toMy * MIN_PER_STOP) + '분' : (Math.abs(toMy) < 1e-6 ? '내 정류장 도착' : '내 정류장 지남 · 종점까지 ' + (span - Math.floor(pos + 1e-6)) + '정거장');

    var stopItems = stops.map(function (name, i) {
      var passed = i < pos - 1e-6, here = atStop && i === cur;
      var s = bub(Math.abs(i - pos + pan / SP));
      var tag = i === my ? '내 정류장' : i === 0 ? '기점' : i === span ? '종점' : '';
      var ahead = i > pos + 1e-6;
      var dot = 'position: absolute; top: 125px; left: ' + (i * SP - 8) + 'px; width: 16px; height: 16px; border-radius: 8px; box-sizing: border-box; transform: scale(' + s.toFixed(3) + '); transition: transform .45s ' + BOUNCE + '; ';
      dot += here ? 'background: ' + accent + '; border: 3px solid #FFFFFF; box-shadow: 0 0 0 2px ' + accent + ';' : passed ? 'background: #D0D0D0; border: 3px solid #FFFFFF;' : 'background: #FFFFFF; border: 3px solid ' + accent + ';';
      var lab = 'font-size: 12px; line-height: 15px; text-align: center; word-break: keep-all; ';
      lab += here ? 'font-weight: 700; color: ' + accent + ';' : passed ? 'font-weight: 500; color: #696969;' : (tag ? 'font-weight: 700; color: #000000;' : 'font-weight: 500; color: #000000;');
      return {
        name: name, labelStyle: lab, dotStyle: dot, tag: tag, ahead: ahead, passed: passed, pastSeats: seatText(seatsAt(tb, i, span)),
        probs: LEVELS.map(function (k) { var p = prob(tb, i, span, k); return { k: k, pct: pct(p), style: 'font-weight: 700; font-variant-numeric: tabular-nums; color: ' + textOf(p) + ';' }; }),
        tagStyle: 'font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 5px; color: #FFFFFF; white-space: nowrap; background: ' + (i === my ? accent : '#000000') + ';',
        labelWrapStyle: 'position: absolute; top: 152px; left: ' + (i * SP - 48) + 'px; width: 96px; display: flex; flex-direction: column; align-items: center; gap: 4px; transform-origin: 50% 0; transform: scale(' + Math.min(s, 1.15).toFixed(3) + '); transition: transform .45s ' + BOUNCE + ';'
      };
    });

    var ghosts = buses.map(function (b) {
      var hidden = b.id === tb.id || self.props.mode !== 'mock';
      var s = bub(Math.abs(b.pos - pos + pan / SP));
      return { id: b.id, style: 'position: absolute; top: 104px; left: ' + (b.pos * SP - 18) + 'px; width: 36px; height: 24px; opacity: ' + (hidden ? 0 : 0.55) + '; transform-origin: 50% 100%; transform: scale(' + s.toFixed(3) + '); transition: ' + (b.jump ? 'opacity .3s ease' : 'left 3s linear, transform .45s ' + BOUNCE + ', opacity .3s ease') + ';' };
    });

    var busScale = bub(Math.abs(pan) / SP);
    var lineVisible = phase === 'line';
    var d = Math.round(-pan / SP);
    var W = 326;
    var winL = Math.max(0, (vc - HALF) / span * W), winR = Math.min(W, (vc + HALF) / span * W);

    var stage = st.stage, flying = phase === 'fly';
    var fx = stage >= 1 ? TX : st.fromX, fyy = stage >= 1 ? TY : st.fromY;

    return {
      routeNo: key, kind: R.kind, accent: accent, soft: R.soft, tabs: tabs,
      fromName: stops[0], toName: stops[span], myName: stops[my],
      comingText: cnt > 0 ? cnt + '대 오는 중' : '오는 버스 없음',
      waitHead: waitHead, waitSub: waitSub, waitPct: cnt > 0 ? pct(waitP) : '-',
      historyLoading: !!this.props.historyLoading, histNote: '', need: need, views: views, levels: levels, view: st.view, histRows: histRows, histTabs: histTabs, histFull: histFull, histAvg: histAvg, histFive: histFive,
      waitPctStyle: 'font-size: 26px; font-weight: 700; letter-spacing: -0.5px; color: ' + textOf(waitP) + ';',
      moveText: moveText, frets: frets, strings: strings, nodes: nodes, marks: marks, fleet: fleet,
      stringsViewStyle: 'position: absolute; inset: 0; opacity: ' + (phase === 'strings' ? 1 : 0) + '; pointer-events: ' + (phase === 'strings' ? 'auto' : 'none') + '; transition: opacity .35s ease;',
      lineViewStyle: 'position: absolute; inset: 0; box-sizing: border-box; padding-top: 54px; display: flex; flex-direction: column; gap: 8px; opacity: ' + (phase === 'strings' ? 0 : 1) + '; pointer-events: ' + (lineVisible ? 'auto' : 'none') + '; transition: opacity .45s ease ' + (phase === 'strings' ? '0s' : '.15s') + ';',
      flyStyle: 'position: absolute; left: ' + (fx - 15) + 'px; top: ' + (fyy - 22) + 'px; width: 30px; height: 44px; pointer-events: none; z-index: 5; opacity: ' + (flying ? 1 : 0) + '; transform: rotate(' + (stage >= 1 ? 90 : 0) + 'deg) scale(' + (stage >= 1 ? PS : 1) + '); transition: ' + (stage >= 1 && flying ? 'left .62s cubic-bezier(.5,0,.2,1), top .62s cubic-bezier(.5,0,.2,1), transform .62s ' + BOUNCE : 'none') + ';',
      flyTopStyle: 'position: absolute; left: 0; top: 0; opacity: ' + (stage >= 2 ? 0 : 1) + '; transition: opacity .25s ease;',
      flySideStyle: 'position: absolute; left: -15px; top: 1px; opacity: ' + (stage >= 2 ? 1 : 0) + '; transform: rotate(-90deg) scale(' + (stage >= 2 ? 0.732 : 0.6) + '); transition: opacity .2s ease, transform .3s ' + BOUNCE + ';',
      trackedLabel: (trackedRank !== undefined ? ordinal(trackedRank) + ' 버스' : '지나간 버스') + '',
      statusLabel: this.props.mode !== 'mock' ? '차량 위치 정보 없음' : atEnd ? '종점 도착' : atStop ? stops[cur] + ' 정차 중 · 다음 정류장' : '다음 정류장',
      nextName: stops[nextIdx], etaText: atEnd ? '도착' : (nextIdx - pos) <= 0.3 ? '곧 도착' : mins + '분',
      myLine: this.props.mode === 'mock' ? myLine : '차량 위치 정보 없음', tSeats: seatText(tSeats), trackProbs: trackProbs, beforeMy: toMy >= -1e-6,
      busState: this.props.mode !== 'mock' ? '차량 위치 정보 없음' : atEnd ? '종점 도착' : atStop ? stops[cur] + ' 정차 중' : stops[nextIdx] + ' 가는 중',
      panStyle: 'position: absolute; inset: 0; transform: translateX(' + pan + 'px); transition: ' + (st.dragging ? 'none' : 'transform 0.35s ease') + ';',
      innerStyle: 'position: absolute; left: 0; top: 0; width: 0; height: 100%; transform: translateX(' + (C - pos * SP) + 'px); transition: ' + (tb.jump || flying ? 'none' : 'transform 3s linear') + ';',
      lineW: span * SP,
      passedStyle: 'position: absolute; left: 0; top: 130px; height: 6px; border-radius: 3px; background: ' + accent + '; width: ' + (pos * SP) + 'px; transition: ' + (tb.jump || flying ? 'none' : 'width 3s linear') + ';',
      stopItems: stopItems, ghosts: ghosts,
      myBusStyle: 'position: absolute; left: 165px; top: 86px; width: 60px; height: 42px; pointer-events: none; transform-origin: 50% 100%; transform: scale(' + busScale.toFixed(3) + '); transition: transform .45s ' + BOUNCE + '; opacity: ' + (lineVisible && this.props.mode === 'mock' ? 1 : 0) + ';',
      myBusLabelStyle: 'position: absolute; left: 0; width: 390px; top: 22px; display: flex; justify-content: center; pointer-events: none; opacity: ' + (lineVisible ? 1 : 0) + '; transform: translateY(' + ((busScale - 1.45) * -40).toFixed(1) + 'px); transition: opacity .3s ease, transform .45s ' + BOUNCE + ';',
      hiddenLeft: Math.max(0, Math.ceil(vc - HALF)), hiddenRight: Math.max(0, span - Math.floor(vc + HALF)),
      panned: Math.abs(pan) > 4,
      viewLabel: d === 0 ? '정류장별 좌석' : d > 0 ? d + '정류장 뒤' : (-d) + '정류장 앞',
      ovBusX: pos / span * W - 6, ovMyX: my / span * W - 1,
      ovWindowStyle: 'position: absolute; top: 0; height: 18px; border-radius: 9px; background: rgba(236,0,0,0.08); border: 1.5px solid #EC0000; box-sizing: border-box; left: ' + winL + 'px; width: ' + Math.max(18, winR - winL) + 'px; transition: ' + (st.dragging ? 'none' : 'left 0.35s ease, width 0.35s ease') + ';'
    };
  }

  renderLoading() {
    return html`
<button class="screen" onClick=${this.skipLoading} aria-label="노선 선택으로 이동" style="border: 0; padding: 0; background: #FFFFFF; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 28px; cursor: pointer; color: #000000">
  <div style="width: 220px; height: 70px; position: relative">
    <div style="position: absolute; left: 0; right: 0; top: 50px; height: 4px; border-radius: 2px; background: #E9E9E9"></div>
    <div class="stopdot" style="left: 10px"></div><div class="stopdot" style="left: 103px"></div><div class="stopdot" style="left: 196px"></div>
    <div class="slide" style="position: absolute; left: 84px; top: 4px; width: 52px; height: 36px">${BUS_SIDE('#EC0000', 52, 36)}</div>
  </div>
  <div style="display: flex; flex-direction: column; align-items: center; gap: 8px">
    <div style="font-size: 40px; font-weight: 700; letter-spacing: -0.5px">HopOrNot</div>
    <div style="font-size: 15px; color: #696969">도착 시 좌석 예측</div>
  </div>
  <div style="position: absolute; bottom: 72px; display: flex; flex-direction: column; align-items: center; gap: 12px">
    <div class="spinner"></div>
    <div style="font-size: 13px; color: #696969">불러오는 중</div>
  </div>
</button>`;
  }

  renderSelect() {
    var self = this;
    return html`
<div class="screen" style="box-sizing: border-box; padding: 64px 16px 34px; display: flex; flex-direction: column; gap: 20px; background: #FBF1EA">
  <div style="display: flex; flex-direction: column; gap: 4px; padding: 0 4px">
    <div style="font-size: 13px; font-weight: 600; color: #696969">${this.props.selection.direction === 'TO_CAMPUS' ? '서울 출발' : '국제캠퍼스 출발'}</div>
    <h1 style="margin: 0; font-size: 40px; font-weight: 700; letter-spacing: -0.4px">노선 선택</h1>
  </div>
  <div style="display: flex; flex-direction: column; gap: 12px">
    ${SELECT_ROUTES.map(function (r) {
      var R = self.props.routeViews[r.no], st = R.stops; r = { ...r, running: r.no === self.props.route ? self.props.vehicles.length : "—", eta: r.no === self.props.route && self.props.vehicles[0]?.etaAt ? Math.max(0,Math.ceil((Date.parse(self.props.vehicles[0].etaAt)-Date.parse(self.props.now))/60000))+"분" : "—", seats: r.no === self.props.route && self.props.vehicles[0]?.currentObservation?.remainingSeats != null ? seatText(self.props.vehicles[0].currentObservation.remainingSeats) : "—", advice: "내 정류장 도착 시 좌석 여유 비교" };
      return html`<button key=${r.no} onClick=${function () { self.openRoute(r.no); }} style="display: flex; align-items: center; gap: 14px; min-height: 96px; padding: 16px; box-sizing: border-box; background: #FFFFFF; border: 0; border-radius: 16px; text-align: left; cursor: pointer; color: #000000">
        <div style=${'width: 52px; height: 52px; border-radius: 14px; background: ' + R.color + '; display: flex; align-items: center; justify-content: center; flex-shrink: 0'}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="15" rx="3"></rect><line x1="4" y1="11" x2="20" y2="11"></line><line x1="7" y1="21" x2="7" y2="18"></line><line x1="17" y1="21" x2="17" y2="18"></line></svg>
        </div>
        <div style="display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0">
          <div style="display: flex; align-items: center; gap: 8px">
            <span style="font-size: 26px; font-weight: 700; letter-spacing: -0.3px">${r.no}</span>
            <span style=${'font-size: 11px; font-weight: 700; padding: 3px 7px; border-radius: 6px; background: ' + R.soft + '; color: ' + R.color}>${R.kind}</span>
          </div>
          <div style="font-size: 14px; color: #696969">${st[0]} → ${st[st.length - 1]}</div>
          <div style="font-size: 12px; color: #696969">도착 ${r.eta} · 현재 ${r.seats}</div>
        </div>
        <svg width="10" height="16" viewBox="0 0 10 16" fill="none" stroke="#696969" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="2,2 8,8 2,14"></polyline></svg>
      </button>`;
    })}
  </div>
  <div style="margin-top: auto; display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 13px; color: #696969">
    <span style="width: 8px; height: 8px; border-radius: 4px; background: #696969"></span><span>도착 시 좌석 예측</span>
  </div>
</div>`;
  }

  renderForecast(v) {
    return html`<${Fragment}>
    <div style="position: absolute; left: 16px; right: 16px; top: 190px; height: 114px; box-sizing: border-box; padding: 10px 14px; border-radius: 16px; background: #FFFFFF; display: flex; flex-direction: column; gap: 6px">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px">
        <span style="font-size: 12px; font-weight: 600; color: #696969; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">내 정류장 · ${v.myName} · ${v.comingText}</span>
        <span style="font-size: 11px; font-weight: 700; padding: 2px 6px; border-radius: 5px; background: #DEEDF2; color: #EC0000; white-space: nowrap">좌석 예측</span>
      </div>
      <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 10px">
        <div style="display: flex; flex-direction: column; gap: 1px; min-width: 0">
          <span style="font-size: 20px; font-weight: 700; letter-spacing: -0.4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">${v.waitHead}</span>
          <span style="font-size: 13px; color: #696969">${v.waitSub}</span>
        </div>
        <div style="display: flex; flex-direction: column; align-items: flex-end; flex-shrink: 0">
          <span style="font-size: 11px; color: #696969">도착 시 ${v.need}석 이상</span>
          <span style=${v.waitPctStyle}>${v.waitPct}</span>
        </div>
      </div>
      <div style="height: 0.5px; background: #E9E9E9"></div>
      <div style="display: flex; align-items: center; gap: 8px; min-width: 0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#696969" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="13" cy="4" r="2"></circle><path d="M9 21l2-6 3 3v3"></path><path d="M8 11l3-3 3 2 3 1"></path><path d="M11 8l-1 5"></path></svg>
        <span style="font-size: 13px; color: #000000; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">${v.moveText}</span>
      </div>
    </div>
    <div style="position: absolute; left: 0; right: 0; top: 312px; bottom: 0; background: #FFFFFF; border-top: 0.5px solid #E9E9E9"></div>
    ${v.frets.map(function (f, i) {
      return html`<${Fragment} key=${'f' + i}>
        <div style=${f.lineStyle}></div>
        <button onClick=${f.pick} aria-label=${f.aria} style=${f.btnStyle}>
          <span style=${f.nameStyle}>${f.name}</span>
          ${f.isMy ? html`<span style=${'font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 5px; background: ' + v.accent + '; color: #FFFFFF'}>내 정류장</span>` : null}
          ${f.isMove ? html`<span style="font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 5px; background: #000000; color: #FFFFFF">여기서 타면 유리</span>` : null}
        </button>
      </${Fragment}>`;
    })}
    ${v.strings.map(function (s) {
      return html`<${Fragment} key=${'l' + s.id}>
        <div style=${s.highStyle}></div>
        <div style=${s.lowStyle}></div>
      </${Fragment}>`;
    })}
    <div style="position: absolute; left: 16px; top: 318px; width: 124px; height: 34px; display: flex; flex-direction: column; justify-content: center">
      <span class="ell" style=${'font-size: 13px; font-weight: 700; color: ' + v.accent}>${v.myName}</span>
      <span style="font-size: 11px; color: #696969">도착 순서</span>
    </div>
    <div style="position: absolute; left: 8px; right: 8px; top: 354px; height: 24px; border-radius: 8px; background: #000000"></div>
    <div style="position: absolute; left: 16px; top: 354px; height: 24px; display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; color: #FFFFFF"><span style="width: 7px; height: 7px; border-radius: 4px; background: #696969"></span>지금 잔여석</div>
    <div style="position: absolute; left: 8px; right: 8px; top: 380px; height: 70px; border-radius: 8px; background: #DEEDF2"></div>
    <div style="position: absolute; left: 16px; top: 380px; height: 70px; display: flex; flex-direction: column; justify-content: center; font-size: 11px; line-height: 15px; font-weight: 700; color: #EC0000"><span>도착 시</span><span>남을 확률</span><span style="font-weight: 500">(예측)</span></div>
    ${v.strings.map(function (s) {
      return html`<${Fragment} key=${'s' + s.id}>
        <div style=${s.headStyle}>
          <span style=${'font-size: 11px; font-weight: ' + (s.rec ? 800 : 600) + '; color: ' + (s.rec ? '#EC0000' : '#696969')}>${s.label}</span>
          <span style="font-size: 14px; font-weight: 700; letter-spacing: -0.3px; color: #000000">${s.eta}</span>
        </div>
        <div style=${s.seatStyle}>${s.seats}</div>
        ${s.cells.map(function (c) { return html`<div key=${c.k} style=${c.style}>${c.pct}</div>`; })}
      </${Fragment}>`;
    })}
    ${v.levels.map(function (l) { return html`<button key=${l.k} onClick=${l.pick} aria-pressed=${l.on} aria-label=${l.k + '석 이상 기준으로 보기'} style=${l.style}>${l.k}석 이상</button>`; })}
    ${v.strings.map(function (s) { return s.rec ? html`<div key=${'r' + s.id} style=${s.recStyle}></div>` : null; })}
    ${v.nodes.map(function (nd) { return html`<div key=${nd.key} style=${nd.style}></div>`; })}
    ${v.marks.map(function (m) { return html`<${Fragment} key=${m.key}><div class="ring" style=${m.style}></div><div style=${m.style}></div></${Fragment}>`; })}
    ${v.fleet.map(function (b) {
      return html`<button key=${'b' + b.id} onClick=${b.pick} aria-label=${b.aria} style=${b.style}>
        ${b.stopped ? html`<span class="pulse" style=${'position: absolute; left: 4px; top: -4px; width: 36px; height: 52px; border-radius: 12px; border: 2px solid ' + b.color + '; box-sizing: border-box'}></span>` : html`<${Fragment}>
          <span style=${'position: absolute; left: 13px; top: 44px; width: 4px; height: 14px; border-radius: 2px; background: linear-gradient(180deg, ' + b.trail + ', rgba(255,255,255,0))'}></span>
          <span style=${'position: absolute; left: 27px; top: 44px; width: 4px; height: 14px; border-radius: 2px; background: linear-gradient(180deg, ' + b.trail + ', rgba(255,255,255,0))'}></span>
        </${Fragment}>`}
        <span style="position: absolute; left: 7px; top: 0; display: block">${BUS_TOP(b.color)}</span>
        <span style="position: absolute; left: 50%; top: 15px; transform: translateX(-50%); min-width: 20px; box-sizing: border-box; padding: 1px 3px; border-radius: 5px; background: #000000; color: #FFFFFF; font-size: 11px; line-height: 14px; font-weight: 700; text-align: center; font-variant-numeric: tabular-nums">${b.seats}</span>
      </button>`;
    })}
    <div style="position: absolute; left: 12px; right: 12px; top: 804px; display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 11px; color: #696969; white-space: nowrap">
      <span style="font-weight: 600">도착 시 ${v.need}석 이상</span>
      <span class="lg"><span class="lgdot" style="background: #EC0000"></span>70% 이상</span>
      <span class="lg"><span class="lgdot" style="background: #EA6F5D"></span>40–69%</span>
      <span class="lg"><span class="lgdot" style="background: #F5DECF"></span>40% 미만</span>
    </div>
    <div style="position: absolute; left: 8px; right: 8px; top: 822px; text-align: center; font-size: 10px; color: #696969">버스 선택 · 정류장 변경</div>
    </${Fragment}>`;
  }

  renderHistory(v) {
    return html`<div style="position: absolute; left: 0; right: 0; top: 192px; bottom: 0; background: #FFFFFF; border-top: 0.5px solid #E9E9E9; box-sizing: border-box; padding: 14px 16px 0; display: flex; flex-direction: column; gap: 12px">
      <div style="display: flex; flex-direction: column; gap: 3px">
        <div style="display: flex; align-items: center; gap: 8px">
          <span class="ell" style="font-size: 20px; font-weight: 700; letter-spacing: -0.3px">${v.myName}</span>
          <span style="font-size: 11px; font-weight: 700; padding: 2px 6px; border-radius: 5px; background: #E9E9E9; color: #696969; white-space: nowrap">실측 기록</span>
        </div>
        <div style="font-size: 13px; color: #696969">도착 좌석 기록</div>
      </div>
      <div style="height: 36px; flex-shrink: 0; box-sizing: border-box; padding: 3px; border-radius: 10px; background: #F5DECF; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 3px">
        ${v.histTabs.map(function (t) { return html`<button key=${t.id} onClick=${t.pick} style=${t.style}>${t.label}</button>`; })}
      </div>
      <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; flex-shrink: 0">
        ${[['평균 잔여', v.histAvg + '석'], ['만석 도착', v.histFull + '대'], ['5석 이상 도착', v.histFive + '대']].map(function (t) {
          return html`<div key=${t[0]} style="padding: 8px 10px; border-radius: 12px; background: #FBF1EA; display: flex; flex-direction: column; gap: 1px"><span style="font-size: 11px; color: #696969">${t[0]}</span><span style="font-size: 19px; font-weight: 700; font-variant-numeric: tabular-nums">${t[1]}</span></div>`;
        })}
      </div>
      <div style="flex: 1; min-height: 0; overflow-y: auto; padding-bottom: 28px">
        ${v.histRows.length === 0 ? html`<div style="padding: 20px 8px; font-size: 14px; color: #696969">${v.historyLoading ? '기록을 불러오는 중…' : '기록 없음 · 수집 범위 밖일 수 있습니다'}</div>` : null}
        ${v.histRows.map(function (r, i) {
          return html`<div key=${i} style=${'display: flex; align-items: center; gap: 12px; height: 44px; padding: 0 8px; border-radius: 8px; border-bottom: 0.5px solid #E9E9E9; ' + (r.near ? 'background: #FBF1EA;' : '')}>
            <span style="width: 46px; font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums">${r.time}</span>
            <span style="flex: 1; height: 8px; border-radius: 4px; background: #E9E9E9; overflow: hidden"><span style=${'display: block; height: 100%; border-radius: 4px; background: #696969; width: ' + (r.seats !== null && r.seats >= 0 ? r.seats / CAP * 100 : 0) + '%'}></span></span>
            <span style=${'width: 48px; text-align: right; font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; color: ' + (r.seats === 0 ? '#990000' : '#000000')}>${seatText(r.seats)}</span>
          </div>`;
        })}
      </div>
    </div>`;
  }

  renderLive() {
    var v = this.vals();
    return html`
<div class="screen" style="background: #FBF1EA">
  <div style=${v.stringsViewStyle}>
    <div style="position: absolute; left: 12px; right: 16px; top: 54px; height: 44px; display: flex; align-items: center; gap: 8px">
      <button onClick=${this.backToSelect} class="navbtn">${CHEVRON}<span>노선</span></button>
      <div style="flex: 1; height: 36px; box-sizing: border-box; padding: 3px; border-radius: 10px; background: #F5DECF; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 3px">
        ${v.tabs.map(function (t) { return html`<button key=${t.no} onClick=${t.pick} style=${t.style}>${t.no}</button>`; })}
      </div>
    </div>
    <div style="position: absolute; left: 20px; right: 20px; top: 100px; height: 44px; display: flex; align-items: center; gap: 10px">
      <span style="font-size: 32px; font-weight: 700; letter-spacing: -0.5px">${v.routeNo}</span>
      <span style=${'font-size: 11px; font-weight: 700; padding: 3px 7px; border-radius: 6px; background: ' + v.soft + '; color: ' + v.accent}>${v.kind}</span>
      <span style="font-size: 14px; color: #696969; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">${v.toName} 방면</span>
      <span style="margin-left: auto; display: flex; align-items: center; gap: 5px; font-size: 12px; color: #696969; white-space: nowrap"><span style="width: 7px; height: 7px; border-radius: 4px; background: #696969"></span>${this.props.mode === 'mock' ? '예시 재생' : '서비스 데이터'}</span>
    </div>
    <div style="position: absolute; left: 16px; right: 16px; top: 148px; height: 36px; box-sizing: border-box; padding: 3px; border-radius: 10px; background: #F5DECF; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 3px">
      ${v.views.map(function (t) { return html`<button key=${t.id} onClick=${t.pick} style=${t.style}>${t.label}</button>`; })}
    </div>
    ${v.view === 'history' ? this.renderHistory(v) : this.renderForecast(v)}
  </div>

  <div style=${v.lineViewStyle}>
    <div style="display: flex; align-items: center; justify-content: space-between; padding: 0 12px; height: 44px; flex-shrink: 0">
      <button onClick=${this.backToStrings} class="navbtn">${CHEVRON}<span>도착 순서</span></button>
      <div style="font-size: 12px; font-weight: 600; padding: 6px 10px; border-radius: 14px; background: #FFFFFF; color: #696969; max-width: 170px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">내 정류장 · ${v.myName}</div>
    </div>
    <div style="height: 58px; flex-shrink: 0; padding: 0 20px; display: flex; flex-direction: column; justify-content: center; gap: 2px">
      <div style="display: flex; align-items: center; gap: 10px">
        <span style="font-size: 32px; font-weight: 700; letter-spacing: -0.5px">${v.routeNo}</span>
        <span style=${'font-size: 11px; font-weight: 700; padding: 3px 7px; border-radius: 6px; background: ' + v.soft + '; color: ' + v.accent}>${v.trackedLabel}</span>
      </div>
      <div class="ell" style="font-size: 13px; color: #696969">${v.statusLabel} ${v.nextName} · ${v.etaText}</div>
    </div>
    <div style="flex-shrink: 0; margin: 0 16px; display: flex; gap: 8px; height: 122px">
      <div style="width: 116px; flex-shrink: 0; box-sizing: border-box; padding: 12px; border-radius: 16px; background: #000000; color: #FFFFFF; display: flex; flex-direction: column; justify-content: space-between">
        <div style="display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700"><span style="width: 7px; height: 7px; border-radius: 4px; background: #696969"></span>지금 잔여석</div>
        <div style="font-size: 38px; font-weight: 700; letter-spacing: -1px; line-height: 40px; font-variant-numeric: tabular-nums">${v.tSeats}</div>
        <div style="font-size: 11px; color: #D0D0D0">관측</div>
      </div>
      <div style="flex: 1; min-width: 0; box-sizing: border-box; padding: 12px; border-radius: 16px; background: #DEEDF2; display: flex; flex-direction: column; justify-content: space-between">
        <div class="ell" style="font-size: 12px; font-weight: 700; color: #EC0000">${v.myName} 도착 시 남을 확률</div>
        ${v.beforeMy ? html`<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px">
          ${v.trackProbs.map(function (t) { return html`<div key=${t.k} style="display: flex; flex-direction: column; gap: 1px"><span style=${t.style}>${t.pct}</span><span style="font-size: 11px; font-weight: 600; color: #696969">${t.k}석 이상</span></div>`; })}
        </div>` : html`<div style="font-size: 15px; font-weight: 700; color: #696969">내 정류장을 지났습니다</div>`}
        <div class="ell" style="font-size: 11px; color: #696969">예측 · ${v.myLine}</div>
      </div>
    </div>
    <div onPointerDown=${this.down} onPointerMove=${this.move} onPointerUp=${this.up} onPointerCancel=${this.up} style="position: relative; flex-shrink: 0; width: 390px; height: 300px; background: #FFFFFF; border-top: 0.5px solid #E9E9E9; border-bottom: 0.5px solid #E9E9E9; overflow: hidden; touch-action: none; cursor: grab; user-select: none">
      <div style=${v.panStyle}>
        <div style=${v.innerStyle}>
          <div style=${'position: absolute; left: 0; top: 130px; height: 6px; border-radius: 3px; background: #E9E9E9; width: ' + v.lineW + 'px'}></div>
          <div style=${v.passedStyle}></div>
          ${v.stopItems.map(function (s, i) {
            return html`<${Fragment} key=${'st' + i}>
              <div style=${s.dotStyle}></div>
              <div style=${s.labelWrapStyle}>
                <div style=${s.labelStyle}>${s.name}</div>
                ${s.tag ? html`<div style=${s.tagStyle}>${s.tag}</div>` : null}
                ${s.passed ? html`<div style="font-size: 11px; font-weight: 600; padding: 2px 6px; border-radius: 5px; background: #FBF1EA; color: #696969; white-space: nowrap">지날 때 ${s.pastSeats}</div>` : null}
                ${s.ahead ? html`<div style="width: 92px; box-sizing: border-box; padding: 4px 6px; border-radius: 7px; background: #DEEDF2; display: flex; flex-direction: column; gap: 1px; font-size: 10.5px; line-height: 14px">
                  <div style="font-size: 10px; font-weight: 700; color: #EC0000">도착 시 예측</div>
                  ${s.probs.map(function (q) { return html`<div key=${q.k} style="display: flex; justify-content: space-between; color: #696969"><span>${q.k}석 이상</span><span style=${q.style}>${q.pct}</span></div>`; })}
                </div>` : null}
              </div>
            </${Fragment}>`;
          })}
          ${v.ghosts.map(function (g) { return html`<div key=${'g' + g.id} style=${g.style}>${BUS_SIDE('#696969', 36, 24, '#696969')}</div>`; })}
        </div>
        <div style=${v.myBusLabelStyle}>
          <div style="font-size: 12px; font-weight: 700; padding: 5px 10px; border-radius: 12px; background: #000000; color: #FFFFFF; white-space: nowrap">지금 ${v.tSeats} · ${v.busState}</div>
        </div>
        <div style=${v.myBusStyle}>${BUS_SIDE(v.accent, 60, 42)}</div>
      </div>
      <div style="position: absolute; left: 0; top: 0; bottom: 0; width: 34px; background: linear-gradient(90deg, #FFFFFF, rgba(255,255,255,0)); pointer-events: none"></div>
      <div style="position: absolute; right: 0; top: 0; bottom: 0; width: 34px; background: linear-gradient(270deg, #FFFFFF, rgba(255,255,255,0)); pointer-events: none"></div>
      <div style="position: absolute; left: 12px; bottom: 8px; font-size: 11px; font-weight: 600; color: #696969; pointer-events: none">‹ 이전 ${v.hiddenLeft}개</div>
      <div style="position: absolute; right: 12px; bottom: 8px; font-size: 11px; font-weight: 600; color: #696969; pointer-events: none">다음 ${v.hiddenRight}개 ›</div>
    </div>
    <div style="padding: 0 16px; min-height: 36px; display: flex; align-items: center; justify-content: space-between; gap: 8px">
      <div style="font-size: 13px; color: #696969">${v.viewLabel}</div>
      ${v.panned ? html`<button onClick=${this.goBus} style="min-height: 36px; padding: 0 14px; border: 0; border-radius: 16px; background: #EC0000; color: #FFFFFF; font-size: 14px; font-weight: 600; cursor: pointer">내 버스로</button>` : null}
    </div>
    <div style="margin: 0 16px; padding: 14px 16px 12px; border-radius: 16px; background: #FFFFFF; display: flex; flex-direction: column; gap: 12px">
      <div style="position: relative; width: 326px; height: 18px">
        <div style="position: absolute; left: 0; right: 0; top: 7px; height: 4px; border-radius: 2px; background: #E9E9E9"></div>
        <div style=${'position: absolute; top: 0; width: 2px; height: 18px; background: #000000; left: ' + v.ovMyX + 'px'}></div>
        <div style=${v.ovWindowStyle}></div>
        <div style=${'position: absolute; top: 3px; left: ' + v.ovBusX + 'px; width: 12px; height: 12px; border-radius: 6px; background: ' + v.accent + '; border: 2px solid #FFFFFF; box-sizing: border-box; box-shadow: 0 0 0 1px ' + v.accent}></div>
      </div>
      <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px">
        <button onClick=${this.goStart} class="jump"><span>기점</span><span class="jumpsub">${v.fromName}</span></button>
        <button onClick=${this.goBus} class="jump" style="color: #EC0000; font-weight: 700">내 버스</button>
        <button onClick=${this.goEnd} class="jump"><span>종점</span><span class="jumpsub">${v.toName}</span></button>
      </div>
    </div>
  </div>

  <div style=${v.flyStyle}>
    <span style=${v.flyTopStyle}>${BUS_TOP(v.accent)}</span>
    <span style=${v.flySideStyle}>${BUS_SIDE(v.accent, 60, 42)}</span>
  </div>
</div>`;
  }

  render() {
    var s = this.state.screen;
    return s === 'loading' ? this.renderLoading() : s === 'select' ? this.renderSelect() : this.renderLive();
  }
}
