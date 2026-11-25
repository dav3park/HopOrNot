import Charts
import SwiftUI

/// 지난 7일, 이 정류장: 몇 시에 타면 탈 수 있었나 (GET /history)
///
/// 위: 30분마다 "기다린 사람이 모두 탄 비율"(만석으로 떠나지 않은 버스 비율. 떠날 때 잔여석을 모르면 도착 때 1석 이상 비율).
/// 아래: 날짜 × 시간대마다 도착할 때 평균 잔여석.
struct HistoryCard: View {
    let route: Route
    let history: History
    let now: Date

    @State private var dayKind: DayKind = .weekday

    enum DayKind: String, CaseIterable, Identifiable {
        case weekday = "평일", weekend = "주말"
        var id: String { rawValue }
    }

    private static let windowBefore = 120, windowAfter = 240  // 지금 기준 보여줄 범위 (분)
    private static let goal = 0.9

    init(route: Route, history: History, now: Date) {
        self.route = route
        self.history = history
        self.now = now
        let weekday = Calendar(identifier: .gregorian).component(.weekday, from: now)
        _dayKind = State(initialValue: weekday == 1 || weekday == 7 ? .weekend : .weekday)
    }

    /// 지금 시각 (운행일 기준 분, 새벽 3시 전이면 24시 이후로)
    private var nowMinutes: Int {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Seoul")!
        let c = calendar.dateComponents([.hour, .minute], from: now)
        let m = (c.hour ?? 0) * 60 + (c.minute ?? 0)
        return c.hour ?? 0 < 3 ? m + 1440 : m
    }

    private var window: ClosedRange<Int> {
        let start = max(0, (nowMinutes - Self.windowBefore) / history.slotMinutes * history.slotMinutes)
        return start...(start + Self.windowBefore + Self.windowAfter)
    }

    /// 평일 또는 주말(토·일·공휴일 합침) 시간대별 요약
    private var slots: [SlotSummary] {
        let rows = history.summary.filter { dayKind == .weekday ? $0.dayType == "평일" : $0.dayType != "평일" }
        return Dictionary(grouping: rows, by: \.slot).map { slot, group in
            let buses = group.reduce(0) { $0 + $1.buses }
            let weighted = { (value: (HistorySlot) -> Double) in
                group.reduce(0.0) { $0 + value($1) * Double($1.buses) } / Double(max(buses, 1))
            }
            return SlotSummary(slot: slot, buses: buses, boardable: weighted { $0.boardable },
                               medianSeats: weighted { $0.medianSeats },
                               measured: group.contains { $0.allBoarded != nil })
        }
        .filter { window.contains($0.slot) }
        .sorted { $0.slot < $1.slot }
    }

    private var days: [HistoryDay] {
        history.days.filter { dayKind == .weekday ? $0.dayType == "평일" : $0.dayType != "평일" }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text("지난 7일, 몇 시에 타면 탈 수 있었나").font(.system(size: 17, weight: .bold))
                Text("\(dayKind.rawValue) \(days.count)일 기록 · 줄 선 사람까지 다 탔는지 기준")
                    .font(.system(size: 12)).foregroundStyle(.secondary)
            }
            Picker("요일", selection: $dayKind) {
                ForEach(DayKind.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)

            answer

            if !slots.isEmpty {
                Text("막대: 기다린 사람이 모두 탄(만석으로 떠나지 않은) 버스 비율")
                    .font(.system(size: 11)).foregroundStyle(.secondary)
            }
            if slots.isEmpty {
                Text("이 시간대 기록이 없습니다").font(.system(size: 13)).foregroundStyle(.secondary)
            } else {
                boardableChart
                Divider()
                VStack(alignment: .leading, spacing: 2) {
                    Text("날짜별 도착 잔여석 (평균)").font(.system(size: 13, weight: .semibold))
                    Text("자리를 남기고 도착해도 줄이 더 길면 못 탑니다. 그래서 위 막대와 다를 수 있어요.")
                        .font(.system(size: 11)).foregroundStyle(.secondary)
                }
                seatsHeatmap
                seatLegend
            }
        }
        .card()
    }

    // MARK: 한 줄 답

    private var answer: some View {
        let upcoming = slots.filter { $0.slot + history.slotMinutes > nowMinutes && $0.buses >= 3 }
        let text: String
        let p: Double?
        if let current = upcoming.first, current.slot <= nowMinutes, current.boardable >= Self.goal {
            text = "지금 시간대는 대부분 탔어요"
            p = current.boardable
        } else if let first = upcoming.first(where: { $0.boardable >= Self.goal }) {
            text = "\(Self.clock(first.slot)) 이후에 타면 대부분 탔어요 · 도착 잔여석 약 \(Int(first.medianSeats.rounded()))석"
            p = first.boardable
        } else if let best = upcoming.max(by: { $0.boardable < $1.boardable }) {
            text = "앞으로 4시간 동안 늘 붐볐어요 · 그나마 \(Self.clock(best.slot))"
            p = best.boardable
        } else {
            text = "앞으로의 기록이 부족합니다"
            p = nil
        }
        return HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: "clock").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.accent)
            Text(text).font(.system(size: 14, weight: .semibold)).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            if let p {
                Text(Format.percent(p)).font(.system(size: 17, weight: .heavy)).monospacedDigit().foregroundStyle(Theme.text(p))
            }
        }
        .padding(10)
        .background(Color(hex: 0xEAF1FB).opacity(0.6), in: RoundedRectangle(cornerRadius: 10))
    }

    // MARK: 시간대별 모두 탄 비율

    private var boardableChart: some View {
        Chart {
            ForEach(slots) { s in
                RectangleMark(xStart: .value("시작", s.slot + 3), xEnd: .value("끝", s.slot + history.slotMinutes - 3),
                              yStart: .value("바닥", 0), yEnd: .value("모두 탄 비율", s.boardable * 100))
                    .foregroundStyle(Theme.fill(s.boardable))
                    .opacity(s.buses >= 3 ? 1 : 0.35)
                    .accessibilityLabel("\(Self.clock(s.slot)) 모두 탄 비율 \(Format.percent(s.boardable))")
            }
            RuleMark(x: .value("지금", nowMinutes))
                .foregroundStyle(Color.primary.opacity(0.6))
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                .annotation(position: .top, alignment: .center) {
                    Text("지금").font(.system(size: 10, weight: .bold)).foregroundStyle(.secondary)
                }
            RuleMark(y: .value("목표", Self.goal * 100))
                .foregroundStyle(Color.secondary.opacity(0.4))
                .lineStyle(StrokeStyle(lineWidth: 0.5))
        }
        .chartXScale(domain: window.lowerBound...window.upperBound)
        .chartYScale(domain: 0...100)
        .chartXAxis { hourAxis }
        .chartYAxis {
            AxisMarks(values: [0, 50, 100]) { value in
                AxisGridLine()
                AxisValueLabel { Text("\(value.as(Int.self) ?? 0)%").font(.system(size: 10)) }
            }
        }
        .chartPlotStyle { $0.clipped() }
        .frame(height: 140)
    }

    // MARK: 날짜 × 시간대 평균 잔여석

    private var seatsHeatmap: some View {
        let cells = history.cells.filter { cell in window.contains(cell.slot) && days.contains { $0.day == cell.day } }
        return Chart {
            ForEach(Array(cells.enumerated()), id: \.offset) { _, cell in
                RectangleMark(xStart: .value("시작", cell.slot + 1), xEnd: .value("끝", cell.slot + history.slotMinutes - 1),
                              y: .value("날짜", Self.dayLabel(cell.day)), height: .ratio(0.8))
                    .foregroundStyle(Self.seatColor(cell.meanSeats))
                    .accessibilityLabel("\(Self.dayLabel(cell.day)) \(Self.clock(cell.slot)) 평균 \(Int(cell.meanSeats.rounded()))석")
            }
            RuleMark(x: .value("지금", nowMinutes))
                .foregroundStyle(Color.primary.opacity(0.6))
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
        }
        .chartXScale(domain: window.lowerBound...window.upperBound)
        .chartYScale(domain: days.map { Self.dayLabel($0.day) })
        .chartXAxis { hourAxis }
        .chartYAxis { AxisMarks(position: .leading) { AxisValueLabel().font(.system(size: 10)) } }
        .chartPlotStyle { $0.clipped() }
        .frame(height: CGFloat(max(days.count, 1)) * 26 + 24)
    }

    private var seatLegend: some View {
        HStack(spacing: 10) {
            ForEach([(0.0, "0석"), (5.0, "1–9석"), (15.0, "10–19석"), (30.0, "20석 이상")], id: \.1) { seats, label in
                HStack(spacing: 4) {
                    RoundedRectangle(cornerRadius: 2).fill(Self.seatColor(seats)).frame(width: 12, height: 9)
                    Text(label)
                }
            }
        }
        .font(.system(size: 10.5))
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity)
    }

    private var hourAxis: some AxisContent {
        AxisMarks(values: .stride(by: 60)) { value in
            AxisGridLine()
            AxisValueLabel {
                if let m = value.as(Int.self) { Text("\((m / 60) % 24)시").font(.system(size: 10)) }
            }
        }
    }

    // MARK: 도우미

    struct SlotSummary: Identifiable {
        let slot: Int
        let buses: Int
        let boardable: Double
        let medianSeats: Double
        let measured: Bool
        var id: Int { slot }
    }

    static func clock(_ minutes: Int) -> String { String(format: "%d:%02d", (minutes / 60) % 24, minutes % 60) }

    /// 2026-11-19 → 11/19(목)
    static func dayLabel(_ day: String) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "ko_KR")
        f.timeZone = TimeZone(identifier: "Asia/Seoul")
        f.dateFormat = "yyyy-MM-dd"
        guard let date = f.date(from: day) else { return day }
        f.dateFormat = "M/d(E)"
        return f.string(from: date)
    }

    static func seatColor(_ seats: Double) -> Color {
        switch seats {
        case ..<0.5: Color(hex: 0xF0A04B)
        case ..<10: Color(hex: 0xBFD3F0)
        case ..<20: Color(hex: 0x7FA6DD)
        default: Color(hex: 0x1F5FBF)
        }
    }
}
