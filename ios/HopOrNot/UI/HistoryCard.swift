import Charts
import SwiftUI

/// 지난 7일 도착 잔여석: 날짜 × 30분 시간대마다, 그 시간대에 이 정류장에 도착한 버스의 평균 잔여석 (GET /history).
/// 옆으로 밀어 하루 전체를 본다. 칸을 누르면 그 시간대의 값이 나온다.
struct HistoryCard: View {
    let route: Route
    let history: History
    let now: Date

    @State private var selected: HistoryCell?

    private static let visibleMinutes = 360  // 한 번에 보이는 시간 (6시간)

    /// 지금 시각 (운행일 기준 분, 새벽 3시 전이면 24시 이후로)
    private var nowMinutes: Int {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Seoul")!
        let c = calendar.dateComponents([.hour, .minute], from: now)
        let m = (c.hour ?? 0) * 60 + (c.minute ?? 0)
        return (c.hour ?? 0) < 3 ? m + 1440 : m
    }

    private var domain: ClosedRange<Int> {
        let slots = history.cells.map(\.slot)
        let lower = (slots.min() ?? 360) / history.slotMinutes * history.slotMinutes
        let upper = ((slots.max() ?? 1380) / history.slotMinutes + 1) * history.slotMinutes
        return lower...max(upper, lower + Self.visibleMinutes)
    }

    private var dayLabels: [String] { history.days.map { Self.dayLabel($0.day) } }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text("지난 7일 도착 잔여석").font(.system(size: 17, weight: .bold))
                Text("그 시간대(30분)에 이 정류장에 도착한 버스의 평균 잔여석 · 옆으로 밀어서 보기")
                    .font(.system(size: 12)).foregroundStyle(.secondary)
            }

            if history.cells.isEmpty {
                Text("지난 7일 기록이 없습니다").font(.system(size: 13)).foregroundStyle(.secondary)
            } else {
                heatmap
                readout
                legend
            }
        }
        .card()
    }

    // MARK: 날짜 × 시간대

    private var heatmap: some View {
        let start = min(max(domain.lowerBound, nowMinutes - 90), domain.upperBound - Self.visibleMinutes)
        return Chart {
            ForEach(Array(history.cells.enumerated()), id: \.offset) { _, cell in
                RectangleMark(xStart: .value("시작", cell.slot + 1), xEnd: .value("끝", cell.slot + history.slotMinutes - 1),
                              y: .value("날짜", Self.dayLabel(cell.day)), height: .ratio(0.82))
                    .foregroundStyle(Theme.seats(cell.meanSeats))
                    .opacity(selected == nil || (selected?.day == cell.day && selected?.slot == cell.slot) ? 1 : 0.5)
                    .accessibilityLabel("\(Self.dayLabel(cell.day)) \(Self.clock(cell.slot)) 평균 \(Int(cell.meanSeats.rounded()))석")
            }
            RuleMark(x: .value("지금", nowMinutes))
                .foregroundStyle(Color.primary.opacity(0.6))
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                .annotation(position: .top, alignment: .center) {
                    Text("지금").font(.system(size: 10, weight: .bold)).foregroundStyle(.secondary)
                }
        }
        .chartScrollableAxes(.horizontal)
        .chartXVisibleDomain(length: Self.visibleMinutes)
        .chartScrollPosition(initialX: start)
        .chartXScale(domain: domain)
        .chartYScale(domain: dayLabels)
        .chartXAxis {
            AxisMarks(values: .stride(by: 60)) { value in
                AxisGridLine()
                AxisValueLabel {
                    if let m = value.as(Int.self) { Text("\((m / 60) % 24)시").font(.system(size: 10)) }
                }
            }
        }
        .chartYAxis { AxisMarks(position: .leading) { AxisValueLabel().font(.system(size: 10)) } }
        .chartOverlay { proxy in
            GeometryReader { geo in
                Rectangle().fill(.clear).contentShape(Rectangle())
                    .gesture(SpatialTapGesture().onEnded { tap in select(at: tap.location, proxy: proxy, geo: geo) })
            }
        }
        .frame(height: CGFloat(max(history.days.count, 1)) * 30 + 30)
    }

    private func select(at location: CGPoint, proxy: ChartProxy, geo: GeometryProxy) {
        guard let frame = proxy.plotFrame else { return }
        let plot = geo[frame]
        guard let minutes: Int = proxy.value(atX: location.x - plot.origin.x),
              let label: String = proxy.value(atY: location.y - plot.origin.y) else { return }
        let slot = minutes / history.slotMinutes * history.slotMinutes
        selected = history.cells.first { Self.dayLabel($0.day) == label && $0.slot == slot }
    }

    /// 누른 칸의 값
    private var readout: some View {
        Group {
            if let cell = selected {
                HStack(spacing: 8) {
                    RoundedRectangle(cornerRadius: 3).fill(Theme.seats(cell.meanSeats)).frame(width: 14, height: 14)
                    Text("\(Self.dayLabel(cell.day)) \(Self.clock(cell.slot))~\(Self.clock(cell.slot + history.slotMinutes))")
                        .font(.system(size: 13, weight: .semibold))
                    Text("평균 \(Int(cell.meanSeats.rounded()))석 · 버스 \(cell.buses)대")
                        .font(.system(size: 13)).foregroundStyle(.secondary)
                    Spacer(minLength: 0)
                }
            } else {
                Text("칸을 누르면 그 시간대의 평균 잔여석이 나옵니다").font(.system(size: 12)).foregroundStyle(.tertiary)
            }
        }
        .frame(minHeight: 20, alignment: .leading)
    }

    private var legend: some View {
        HStack(spacing: 12) {
            ForEach([(0.0, "0석"), (5.0, "1–9석"), (15.0, "10–19석"), (30.0, "20석 이상")], id: \.1) { seats, label in
                HStack(spacing: 4) {
                    RoundedRectangle(cornerRadius: 2).fill(Theme.seats(seats)).frame(width: 12, height: 9)
                    Text(label)
                }
            }
        }
        .font(.system(size: 10.5))
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity)
    }

    // MARK: 도우미

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
}
