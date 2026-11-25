import SwiftUI

/// 노선도: 정류장은 세로로, 다가오는 버스는 열 하나씩 (design/ 프로토타입의 "도착 순서" 화면).
///
/// 각 열에는 버스가 지금 있는 자리부터 내 정류장까지, 정류장마다 그 버스가 1석 이상 남아 도착할 확률을 색 점으로
/// 찍는다. 열 머리에는 "이 버스까지 내가 탈 확률"(앞 버스들을 보내는 경우 포함)을 쓴다. 지도보다 "몇 정거장 남았고
/// 그때 몇 %인지"가 한눈에 보이도록 노선만 그린다.
struct RouteStripView: View {
    let route: Route
    let line: LineView
    let prediction: Prediction?
    let recommendedOrder: Int?

    private let rowHeight: CGFloat = 40
    private let headerHeight: CGFloat = 62
    private let nameWidth: CGFloat = 112
    private let maxColumns = 4

    private var buses: [LineBus] { Array(line.buses.prefix(maxColumns)) }
    private var stops: [LineStop] { line.stops }
    private var myIndex: Int { stops.firstIndex(where: \.isMine) ?? max(0, stops.count - 1) }

    var body: some View {
        GeometryReader { geo in
            let columnWidth = (geo.size.width - nameWidth) / CGFloat(max(buses.count, 1))
            ZStack(alignment: .topLeading) {
                ForEach(Array(stops.enumerated()), id: \.element.id) { index, stop in
                    stopRow(stop, index: index, width: geo.size.width)
                }
                ForEach(Array(buses.enumerated()), id: \.element.id) { column, bus in
                    let x = nameWidth + columnWidth * (CGFloat(column) + 0.5)
                    busColumn(bus, column: column, x: x, width: columnWidth)
                }
            }
        }
        .frame(height: headerHeight + rowHeight * CGFloat(stops.count) + 8)
        .accessibilityElement(children: .contain)
    }

    private func y(forRow index: CGFloat) -> CGFloat { headerHeight + rowHeight * (index + 0.5) }

    /// 버스가 지금 있는 세로 위치(행 번호, 소수 가능). 정류장에 도착해 있으면 그 행, 지나서 가는 중이면 다음 행과의 사이.
    /// 노선도 맨 위보다 먼 곳에 있으면 -0.6 (맨 위 바깥)
    private func position(of bus: LineBus) -> CGFloat {
        guard let last = stops.lastIndex(where: { $0.stationSeq <= bus.currentSeq }) else { return -0.6 }
        let exact = stops[last].stationSeq == bus.currentSeq && bus.isAtStop
        return CGFloat(last) + (exact ? 0 : 0.5)
    }

    @ViewBuilder
    private func stopRow(_ stop: LineStop, index: Int, width: CGFloat) -> some View {
        let isMine = stop.isMine
        let y = y(forRow: CGFloat(index))
        Rectangle()
            .fill(isMine ? Theme.route(route) : Theme.hairline.opacity(0.5))
            .frame(width: width - nameWidth + 6, height: isMine ? 2.5 : 0.5)
            .position(x: nameWidth + (width - nameWidth) / 2 - 3, y: y)
        HStack(spacing: 4) {
            Text(stop.stationName)
                .font(.system(size: 12.5, weight: isMine ? .heavy : (index > myIndex ? .regular : .semibold)))
                .foregroundStyle(isMine ? Theme.route(route) : (index > myIndex ? .secondary : .primary))
                .lineLimit(1)
                .truncationMode(.tail)
            if isMine {
                Text("내 정류장")
                    .font(.system(size: 9.5, weight: .bold))
                    .padding(.horizontal, 5).padding(.vertical, 1)
                    .foregroundStyle(.white)
                    .background(Theme.route(route), in: RoundedRectangle(cornerRadius: 4))
                    .fixedSize()
            }
        }
        .frame(width: nameWidth - 6, alignment: .leading)
        .position(x: (nameWidth - 6) / 2, y: y)
    }

    @ViewBuilder
    private func busColumn(_ bus: LineBus, column: Int, x: CGFloat, width: CGFloat) -> some View {
        let at = position(of: bus)
        let top = y(forRow: at)
        let mine = y(forRow: CGFloat(myIndex))
        let byHere = prediction?.mySeat?.byBus.flatMap { bus.order < $0.count ? $0[bus.order] : nil }
        let recommended = bus.order == recommendedOrder

        // 열 머리: 이번/다음 + "이 버스까지 탈 확률"
        VStack(spacing: 1) {
            Text(recommended ? "추천" : Decision.ordinal(bus.order))
                .font(.system(size: 11, weight: recommended ? .bold : .semibold))
                .foregroundStyle(recommended ? Theme.accent : .secondary)
            Text(byHere.map(Format.percent) ?? "–")
                .font(.system(size: 15, weight: .heavy))
                .monospacedDigit()
                .foregroundStyle(byHere.map(Theme.text) ?? .secondary)
            Text("지금 \(bus.currentSeats)석")
                .font(.system(size: 9.5))
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .frame(width: width - 4, height: headerHeight - 8)
        .background(recommended ? Color(hex: 0xEAF1FB) : .clear, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(recommended ? Theme.accent : .clear, lineWidth: 1.5))
        .position(x: x, y: (headerHeight - 8) / 2)

        // 버스에서 내 정류장까지 이어지는 줄
        Rectangle()
            .fill(Color(.systemGray3))
            .frame(width: 2, height: max(0, mine - top))
            .position(x: x, y: (top + mine) / 2)

        // 정류장마다 1석 이상 남아 도착할 확률
        ForEach(Array(stops.enumerated()), id: \.element.id) { index, stop in
            if CGFloat(index) > at, index <= myIndex, let p = bus.pSeat(at: stop.stationSeq) {
                let size: CGFloat = stop.isMine ? 15 : 10
                Circle()
                    .fill(Theme.fill(p))
                    .frame(width: size, height: size)
                    .overlay(Circle().stroke(Theme.card, lineWidth: 2))
                    .position(x: x, y: y(forRow: CGFloat(index)))
                    .accessibilityLabel("\(stop.stationName) 1석 이상 \(Format.percent(p))")
            }
        }

        // 버스 (노선도 위보다 멀면 맨 위에 작은 화살표와 함께)
        VStack(spacing: 0) {
            if at < 0 {
                Image(systemName: "arrow.up").font(.system(size: 8, weight: .bold)).foregroundStyle(.secondary)
            }
            Image(systemName: "bus.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 26, height: 26)
                .background(Theme.route(route), in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.card, lineWidth: 2))
        }
        .position(x: x, y: at < 0 ? headerHeight + 6 : top)
        .accessibilityLabel("\(Decision.ordinal(bus.order)) 버스, 현재 \(bus.currentSeats)석")
    }
}
