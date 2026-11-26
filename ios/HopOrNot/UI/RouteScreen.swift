import SwiftUI

/// 정류장 목록 (네이버 버스처럼): 노선 한 바퀴를 한 줄로.
/// 캠퍼스 → 출발권 정류장 → 고속도로(회색, IC 이름) → 서울 정류장 → 고속도로 → 도착권 정류장 → 캠퍼스.
/// 정류장 줄은 고정이고 버스는 그 위에 겹쳐 놓는다. 위치가 바뀌면 레일을 따라 움직인다 (데모는 2분 간격 장면 재생).
/// 정류장을 누르면 정류장 화면(AI 판단, 노선도/지도, 오는 버스, 탈 확률 높은 정류장, 지난 7일)으로 간다.
struct RouteScreen: View {
    let route: Route
    @Environment(AppModel.self) private var model
    @State private var showSettings = false
    @State private var scrolled = false

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            TopBar(onBack: { dismiss() }) {
                RouteBadge(route: route, size: 26)
            } trailing: {
                RoundIconButton(label: "설정", action: { showSettings = true }) { SlidersGlyph() }
            }
            ScrollViewReader { proxy in
                ScrollView {
                    RouteContent(route: route)
                }
                .refreshable { await model.refreshRoute() }
                .onChange(of: model.routeView == nil) {
                    guard !scrolled, let seq = model.scrollTargetSeq else { return }
                    scrolled = true
                    proxy.scrollTo("stop-\(seq)", anchor: .center)
                }
            }
        }
        .background(Brand.paper.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .task(id: "\(route.rawValue)-\(model.mode.rawValue)") {
            // 데모: 2분 간격 장면을 2.5초마다 (재생). 서버: 30초마다 (수집은 피크 2분 간격)
            while !Task.isCancelled {
                await model.refreshRoute()
                #if DEBUG
                SnapshotRenderer.renderRouteIfRequested(model: model, route: route)
                #endif
                try? await Task.sleep(for: .seconds(model.mode == .demo ? 2.5 : 30))
            }
        }
        .onAppear {
            model.open(route)
            #if DEBUG
            model.debugAutoStation()
            #endif
        }
        .sheet(isPresented: $showSettings) { SettingsView() }
    }
}

/// 정류장 목록 스크롤 내용 (스냅샷에서도 쓴다)
struct RouteContent: View {
    let route: Route
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    LiveDot(label: liveLabel)
                    Spacer()
                    Text("정류장을 누르면 탈 확률").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.accent)
                }
                HStack(spacing: 14) {
                    legend(Theme.route(route), "일반 도로")
                    legend(Theme.highway, "고속도로")
                    Spacer()
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)

            if let error = model.routeStatus.error {
                Group {
                    if model.routeView == nil {
                        ErrorState(error: error) { Task { await model.refreshRoute() } }
                    } else {
                        StaleBanner(error: error, since: model.routeView?.generatedAt) { Task { await model.refreshRoute() } }
                    }
                }
                .padding(.horizontal, 16).padding(.bottom, 8)
            }

            if let view = model.routeView {
                StopRail(route: route, view: view, highlighted: model.stop?.stationSeq) { stop in
                    model.openStation(stop.info)
                }
                .background(Theme.card)
            } else if model.routeStatus.error == nil {
                RoadLoader(text: "\(route.rawValue) 버스 위치를 불러오는 중").padding(.vertical, 56).padding(.horizontal, 24)
            }

            Text("버스 위치는 마지막으로 지난 정류장 기준입니다 (정류장에 도착했으면 그 정류장, 아니면 다음 정류장과의 사이). 버스 옆 숫자는 지금 잔여석입니다.")
                .font(.system(size: 11))
                .foregroundStyle(.tertiary)
                .padding(16)
        }
    }

    private func legend(_ color: Color, _ label: String) -> some View {
        HStack(spacing: 5) {
            RoundedRectangle(cornerRadius: 2).fill(color).frame(width: 16, height: 5)
            Text(label).font(.system(size: 11)).foregroundStyle(.secondary)
        }
    }

    private var liveLabel: String {
        if let replay = model.replayLabel { return replay }
        guard let generated = model.routeView?.generatedAt else { return model.dataLabel }
        return "\(model.dataLabel) · \(Format.time.string(from: generated)) 수집"
    }
}

/// 노선 레일: 왼쪽에 버스(지금 잔여석·차량번호), 가운데 레일, 오른쪽에 정류장 이름.
/// 고속도로 구간은 회색 레일과 작은 줄로, 승하차 정류장은 큰 줄로 그린다.
struct StopRail: View {
    let route: Route
    let view: RouteView
    let highlighted: Int?
    let onSelect: (RouteStop) -> Void

    private let railX: CGFloat = 92
    private let nameX: CGFloat = 116

    private var stops: [RouteStop] { view.stops }

    private func height(_ stop: RouteStop) -> CGFloat {
        switch stop.kind {
        case "highway", "via": 34
        case "campus": 46
        default: 56
        }
    }

    /// 줄마다 위에서부터의 거리
    private var offsets: [CGFloat] {
        var result: [CGFloat] = [], y: CGFloat = 0
        for stop in stops { result.append(y); y += height(stop) }
        return result
    }

    private var totalHeight: CGFloat { stops.reduce(0) { $0 + height($1) } }
    private func center(_ index: Int, _ offsets: [CGFloat]) -> CGFloat { offsets[index] + height(stops[index]) / 2 }

    var body: some View {
        let offsets = self.offsets
        // 줄은 실제 레이아웃(스크롤 위치 계산용), 레일은 뒤에, 버스는 앞에 겹쳐 그린다
        VStack(spacing: 0) {
            ForEach(Array(stops.enumerated()), id: \.element.id) { index, stop in
                stopRow(stop, firstOfHighwayRun: stop.isHighway && (index == 0 || !stops[index - 1].isHighway))
                    .frame(height: height(stop))
                    .id("stop-\(stop.stationSeq)")
            }
        }
        .frame(maxWidth: .infinity)
        .background(alignment: .topLeading) { rail(offsets) }
        .overlay(alignment: .topLeading) {
            ZStack(alignment: .topLeading) {
                ForEach(view.buses) { bus in
                    busMarker(bus)
                        .offset(y: spreadY(of: bus, offsets) - 15)
                }
            }
            .allowsHitTesting(false)
        }
    }

    /// 레일 (고속도로에 닿는 구간은 회색)과 고른 정류장 강조
    private func rail(_ offsets: [CGFloat]) -> some View {
        ZStack(alignment: .topLeading) {
            if let index = stops.firstIndex(where: { $0.stationSeq == highlighted }) {
                Rectangle()
                    .fill(Theme.routeSoft(route).opacity(0.6))
                    .frame(height: height(stops[index]))
                    .frame(maxWidth: .infinity)
                    .offset(y: offsets[index])
            }
            ForEach(0..<max(stops.count - 1, 0), id: \.self) { i in
                let gray = stops[i].isHighway || stops[i + 1].isHighway
                Rectangle()
                    .fill(gray ? Theme.highway : Theme.route(route))
                    .frame(width: 6, height: center(i + 1, offsets) - center(i, offsets))
                    .offset(x: railX - 3, y: center(i, offsets))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .allowsHitTesting(false)
    }

    /// 같은 자리의 버스가 여러 대면 위아래로 벌린다
    private func spreadY(of bus: RouteBus, _ offsets: [CGFloat]) -> CGFloat {
        let base = y(of: bus, offsets)
        let together = view.buses.filter { y(of: $0, offsets) == base }.sorted { $0.vehId < $1.vehId }
        guard together.count > 1, let k = together.firstIndex(where: { $0.id == bus.id }) else { return base }
        let gap: CGFloat = 36
        return base + gap * (CGFloat(k) - CGFloat(together.count - 1) / 2)
    }

    private func y(of bus: RouteBus, _ offsets: [CGFloat]) -> CGFloat {
        guard let index = stops.lastIndex(where: { $0.stationSeq <= bus.currentSeq }) else { return 0 }
        let atStop = stops[index].stationSeq == bus.currentSeq && bus.isAtStop
        return atStop ? center(index, offsets) : offsets[index] + height(stops[index])  // 다음 줄과의 경계
    }

    @ViewBuilder
    private func stopRow(_ stop: RouteStop, firstOfHighwayRun: Bool) -> some View {
        if stop.isTarget {
            Button { onSelect(stop) } label: { rowContent(stop, firstOfHighwayRun: firstOfHighwayRun) }
                .buttonStyle(.plain)
                .accessibilityHint("이 정류장의 탈 확률 보기")
        } else {
            // 눌러도 되지 않는 줄은 버튼으로 만들지 않는다 (disabled 버튼은 자동으로 흐리게 그려진다)
            rowContent(stop, firstOfHighwayRun: firstOfHighwayRun)
        }
    }

    private func rowContent(_ stop: RouteStop, firstOfHighwayRun: Bool) -> some View {
        let isHighlighted = stop.stationSeq == highlighted
        let rowHeight = height(stop)
        return ZStack(alignment: .topLeading) {
            Color.clear
            dot(stop, rowHeight: rowHeight)
            HStack(spacing: 6) {
                if firstOfHighwayRun {
                    Label("고속도로", systemImage: "road.lanes")
                        .font(.system(size: 10, weight: .bold))
                        .labelStyle(.titleAndIcon)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .foregroundStyle(.white)
                        .background(Theme.highway, in: RoundedRectangle(cornerRadius: 5))
                }
                Text(stop.displayName)
                    .font(.system(size: nameSize(stop), weight: isHighlighted ? .heavy : (stop.isPassThrough ? .regular : .medium)))
                    .foregroundStyle(nameColor(stop, highlighted: isHighlighted))
                    .lineLimit(1)
                if stop.isTarget, let direction = stop.direction {
                    Text(direction).font(.system(size: 11)).foregroundStyle(.secondary)
                }
                if stop.stationSeq == view.turnSeq {
                    Text("회차").font(.system(size: 10, weight: .bold))
                        .padding(.horizontal, 5).padding(.vertical, 1)
                        .foregroundStyle(.secondary)
                        .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 4))
                }
                Spacer(minLength: 4)
                if stop.isTarget {
                    Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(.tertiary)
                }
            }
            .frame(height: rowHeight)
            .padding(.leading, nameX)
            .padding(.trailing, 16)
            if !stop.isPassThrough {
                Rectangle().fill(Theme.hairline.opacity(0.4)).frame(height: 0.5)
                    .offset(x: nameX, y: rowHeight - 0.5)
            }
        }
        .contentShape(Rectangle())
    }

    private func nameSize(_ stop: RouteStop) -> CGFloat { stop.isPassThrough ? 12.5 : 15 }

    private func nameColor(_ stop: RouteStop, highlighted: Bool) -> Color {
        if highlighted { return Theme.route(route) }
        if stop.isHighway { return Theme.highwayText }
        if stop.isVia { return .secondary }
        return stop.isTarget ? .primary : .secondary
    }

    @ViewBuilder
    private func dot(_ stop: RouteStop, rowHeight: CGFloat) -> some View {
        let size: CGFloat = stop.isHighway ? 9 : (stop.isVia ? 7 : 14)
        Circle()
            .fill(stop.isHighway ? Theme.highway : (stop.isVia ? Theme.route(route).opacity(0.5) : Theme.card))
            .frame(width: size, height: size)
            .overlay(Circle().stroke(Theme.route(route).opacity(stop.kind == "campus" ? 0.45 : 1),
                                     lineWidth: stop.isPassThrough ? 0 : 3))
            .offset(x: railX - size / 2, y: rowHeight / 2 - size / 2)
    }

    /// 레일 위 버스 아이콘 + 왼쪽에 지금 잔여석·차량번호
    private func busMarker(_ bus: RouteBus) -> some View {
        HStack(spacing: 6) {
            VStack(alignment: .trailing, spacing: 0) {
                Text("\(bus.currentSeats)석")
                    .font(.system(size: 12.5, weight: .heavy))
                    .monospacedDigit()
                    .foregroundStyle(Theme.seatText(bus.currentSeats))
                Text(bus.plateShort).font(.system(size: 10)).foregroundStyle(.secondary)
            }
            .frame(width: railX - 13 - 6 - 8, alignment: .trailing)
            Image(systemName: "bus.fill")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 26, height: 30)
                .background(Theme.route(route), in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.card, lineWidth: 2))
        }
        .padding(.leading, 8)
        .allowsHitTesting(false)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("버스 \(bus.plateShort), 지금 \(bus.currentSeats)석")
    }
}
