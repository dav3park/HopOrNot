import SwiftUI

/// 노선도: 정류장은 세로, 오는 버스는 열 하나씩 (design/ 프로토타입의 "도착 순서" 화면).
///
/// 각 열에는 버스가 지금 있는 자리부터 내 정류장까지, 정류장마다 그 버스가 1석 이상 남아 도착할 확률을 색 점으로
/// 찍는다. 열 머리에는 "이 버스까지 내가 탈 확률"(앞 버스들을 보내는 경우 포함)과 도착할 때 예상 잔여석을 쓴다.
/// 내 정류장 앞쪽은 버스가 오는 길 전체(고속도로 회색, IC 이름 포함)를, 뒤쪽은 몇 정류장을 흐리게 보여 준다.
struct RouteStripView: View {
    let route: Route
    let stops: [RouteStop]        // 노선 한 바퀴 전체
    let line: LineView
    let prediction: Prediction?
    let recommendedOrder: Int?
    let mySeq: Int

    private let headerHeight: CGFloat = 70
    private let nameWidth: CGFloat = 116
    private let maxColumns = 4
    private let maxBefore = 16   // 내 정류장 앞쪽 줄 수 (고속도로 줄 포함)
    private let after = 3        // 내 정류장 뒤쪽 줄 수

    private var buses: [LineBus] { Array(line.buses.prefix(maxColumns)) }
    private var myIndex: Int { stops.firstIndex { $0.stationSeq == mySeq } ?? max(0, stops.count - 1) }

    private func index(of bus: LineBus) -> Int? { stops.lastIndex { $0.stationSeq <= bus.currentSeq } }

    /// 보여 줄 줄 범위: 가장 먼 버스(없으면 내 정류장 앞 5줄)부터 내 정류장 뒤 몇 줄까지
    private var range: ClosedRange<Int> {
        let farthest = buses.compactMap { index(of: $0) }.min() ?? max(0, myIndex - 5)
        let start = max(0, max(min(farthest, myIndex), myIndex - maxBefore))
        return start...min(stops.count - 1, myIndex + after)
    }

    private var rows: [RouteStop] { Array(stops[range]) }

    private func height(_ stop: RouteStop) -> CGFloat { stop.isPassThrough ? 26 : (stop.stationSeq == mySeq ? 46 : 42) }
    private func offsets() -> [CGFloat] {
        var result: [CGFloat] = [], y: CGFloat = 0
        for stop in rows { result.append(y); y += height(stop) }
        return result
    }
    private var bodyHeight: CGFloat { rows.reduce(0) { $0 + height($1) } }

    var body: some View {
        GeometryReader { geo in
            let columnWidth = (geo.size.width - nameWidth) / CGFloat(max(buses.count, 1))
            let offsets = offsets()
            ZStack(alignment: .topLeading) {
                ForEach(Array(rows.enumerated()), id: \.element.id) { i, stop in
                    stopRow(stop, offset: offsets[i], width: geo.size.width)
                }
                ForEach(Array(buses.enumerated()), id: \.element.id) { column, bus in
                    busColumn(bus, x: nameWidth + columnWidth * (CGFloat(column) + 0.5), width: columnWidth, offsets: offsets)
                }
            }
        }
        .frame(height: headerHeight + bodyHeight + 8)
        .accessibilityElement(children: .contain)
    }

    private func center(_ i: Int, _ offsets: [CGFloat]) -> CGFloat { headerHeight + offsets[i] + height(rows[i]) / 2 }

    @ViewBuilder
    private func stopRow(_ stop: RouteStop, offset: CGFloat, width: CGFloat) -> some View {
        let isMine = stop.stationSeq == mySeq
        let afterMine = stop.stationSeq > mySeq
        let y = headerHeight + offset + height(stop) / 2
        Rectangle()
            .fill(isMine ? Theme.route(route) : (stop.isHighway ? Theme.highway.opacity(0.5) : Theme.hairline.opacity(0.5)))
            .frame(width: width - nameWidth + 6, height: isMine ? 2.5 : (stop.isHighway ? 1 : 0.5))
            .position(x: nameWidth + (width - nameWidth) / 2 - 3, y: y)
        HStack(spacing: 4) {
            if stop.isHighway {
                Image(systemName: "road.lanes").font(.system(size: 9)).foregroundStyle(Theme.highway)
            }
            Text(stop.displayName)
                .font(.system(size: stop.isPassThrough ? 11 : 12.5, weight: isMine ? .heavy : (afterMine || stop.isPassThrough ? .regular : .semibold)))
                .foregroundStyle(isMine ? Theme.route(route) : (stop.isHighway ? Theme.highwayText : (afterMine || stop.isVia ? .secondary : .primary)))
                .lineLimit(1)
                .truncationMode(.tail)
            if isMine {
                Text("내 정류장")
                    .font(.system(size: 9, weight: .bold))
                    .padding(.horizontal, 4).padding(.vertical, 1)
                    .foregroundStyle(.white)
                    .background(Theme.route(route), in: RoundedRectangle(cornerRadius: 4))
                    .fixedSize()
            }
        }
        .frame(width: nameWidth - 6, alignment: .leading)
        .position(x: (nameWidth - 6) / 2, y: y)
    }

    @ViewBuilder
    private func busColumn(_ bus: LineBus, x: CGFloat, width: CGFloat, offsets: [CGFloat]) -> some View {
        let busIndex = index(of: bus)
        let local = busIndex.map { $0 - range.lowerBound }       // 보이는 범위 안의 줄 번호
        let above = (local ?? -1) < 0                              // 범위보다 먼 버스
        let atStop = bus.isAtStop && (busIndex.map { stops[$0].stationSeq == bus.currentSeq } ?? false)
        let top: CGFloat = above ? headerHeight + 8
            : (atStop ? center(local!, offsets) : headerHeight + offsets[local!] + height(rows[local!]))
        let mine = center(myIndex - range.lowerBound, offsets)
        let byHere = prediction?.mySeat?.byBus.flatMap { bus.order < $0.count ? $0[bus.order] : nil }
        let recommended = bus.order == recommendedOrder
        let expected = prediction?.buses.first(where: { $0.vehId == bus.vehId })?.expectedSeats

        // 열 머리: 이번/다음 + "이 버스까지 탈 확률" + 예상 잔여석
        VStack(spacing: 1) {
            Text(recommended ? "추천" : Decision.ordinal(bus.order))
                .font(.system(size: 11, weight: recommended ? .bold : .semibold))
                .foregroundStyle(recommended ? Theme.accent : .secondary)
            Text(byHere.map(Format.percent) ?? "–")
                .font(.system(size: 15, weight: .heavy))
                .monospacedDigit()
                .foregroundStyle(byHere.map(Theme.text) ?? .secondary)
            Text(expected.map { "예상 \($0)석" } ?? "지금 \(bus.currentSeats)석")
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

        // 정류장마다 1석 이상 남아 도착할 확률 (예측 대상 정류장만)
        ForEach(Array(rows.enumerated()), id: \.element.id) { i, stop in
            let position = above ? -1.0 : Double(local!) + (atStop ? 0 : 0.5)
            if Double(i) > position, i <= myIndex - range.lowerBound, let p = bus.pSeat(at: stop.stationSeq) {
                let size: CGFloat = stop.stationSeq == mySeq ? 15 : 10
                Circle()
                    .fill(Theme.fill(p))
                    .frame(width: size, height: size)
                    .overlay(Circle().stroke(Theme.card, lineWidth: 2))
                    .position(x: x, y: center(i, offsets))
                    .accessibilityLabel("\(stop.displayName) 1석 이상 \(Format.percent(p))")
            }
        }

        // 버스 (범위보다 멀면 맨 위에 작은 화살표와 함께)
        VStack(spacing: 0) {
            if above {
                Image(systemName: "arrow.up").font(.system(size: 8, weight: .bold)).foregroundStyle(.secondary)
            }
            Image(systemName: "bus.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 26, height: 26)
                .background(Theme.route(route), in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.card, lineWidth: 2))
        }
        .position(x: x, y: top)
        .accessibilityLabel("\(Decision.ordinal(bus.order)) 버스, 현재 \(bus.currentSeats)석")
    }
}
