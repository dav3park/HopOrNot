import SwiftUI

/// 정류장 목록 (네이버 버스처럼): 한 방향의 정류장 목록과, 노선 레일 위를 움직이는 버스.
/// 정류장 줄은 고정이고 버스는 그 위에 겹쳐 놓는다. 위치가 바뀌면 레일을 따라 움직인다 (데모는 2분 간격 장면 재생).
/// 정류장을 누르면 정류장 화면(AI 판단, 노선도·지도, 오는 버스, 지난 7일)으로 간다.
struct RouteScreen: View {
    let route: Route
    @Environment(AppModel.self) private var model
    @State private var showSettings = false
    @State private var scrolled = false

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                RouteContent(route: route)
            }
            .background(Theme.background)
            .refreshable { await model.refreshRoute() }
            .onChange(of: model.direction) { scrolled = false }
            .onChange(of: model.routeView == nil) {
                guard !scrolled, let seq = model.stop?.stationSeq, model.routeView != nil else { return }
                scrolled = true
                proxy.scrollTo("stop-\(seq)", anchor: .center)
            }
        }
        .task(id: "\(route.rawValue)-\(model.direction)-\(model.mode.rawValue)") {
            // 데모: 2분 간격 장면을 2.5초마다 (재생). 서버: 30초마다 (수집은 피크 2분 간격)
            while !Task.isCancelled {
                await model.refreshRoute()
                #if DEBUG
                SnapshotRenderer.renderRouteIfRequested(model: model, route: route)
                #endif
                try? await Task.sleep(for: .seconds(model.mode == .demo ? 2.5 : 30))
            }
        }
        .onAppear { model.open(route) }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text(route.rawValue).font(.system(size: 19, weight: .heavy))
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button { showSettings = true } label: { Image(systemName: "gearshape") }
                    .accessibilityLabel("설정")
            }
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
            VStack(alignment: .leading, spacing: 8) {
                Picker("방향", selection: Binding(get: { model.direction }, set: { model.setDirection($0) })) {
                    Text("서울행 · 출근").tag("서울행")
                    Text("영통행 · 퇴근").tag("영통행")
                }
                .pickerStyle(.segmented)
                HStack {
                    LiveDot(label: liveLabel)
                    Spacer()
                    Text("정류장을 누르면 탈 확률").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.accent)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)

            if let error = model.errorMessage {
                Label(error, systemImage: "exclamationmark.triangle")
                    .font(.system(size: 13))
                    .foregroundStyle(Color(hex: 0xB4570A))
                    .padding(.horizontal, 16).padding(.bottom, 8)
            }

            if let view = model.routeView {
                StopRail(route: route, view: view, highlighted: model.stop?.stationSeq) { stop in
                    model.openStation(stop.info)
                }
                .background(Theme.card)
            } else {
                ProgressView().frame(maxWidth: .infinity).padding(40)
            }

            Text("버스 위치는 마지막으로 지난 정류장 기준입니다 (정류장에 도착했으면 그 정류장, 아니면 다음 정류장과의 사이). 버스 옆 숫자는 지금 잔여석입니다.")
                .font(.system(size: 11))
                .foregroundStyle(.tertiary)
                .padding(16)
        }
    }

    private var liveLabel: String {
        if let replay = model.replayLabel { return replay }
        guard let generated = model.routeView?.generatedAt else { return model.dataLabel }
        return "\(model.dataLabel) · \(Format.time.string(from: generated)) 수집"
    }
}

/// 노선 레일: 왼쪽에 버스(지금 잔여석·차량번호), 가운데 레일, 오른쪽에 정류장 이름
struct StopRail: View {
    let route: Route
    let view: RouteView
    let highlighted: Int?
    let onSelect: (RouteStop) -> Void

    private let rowHeight: CGFloat = 56
    private let laneHeight: CGFloat = 46
    private let railX: CGFloat = 92
    private let nameX: CGFloat = 116

    private var stops: [RouteStop] { view.stops }
    /// 이 방향 첫 정류장으로 오는 중 (고속도로, 캠퍼스 안쪽). 먼 버스가 위
    private var entering: [RouteBus] {
        view.buses.filter { $0.currentSeq < (stops.first?.stationSeq ?? 0) }.sorted { $0.currentSeq < $1.currentSeq }
    }
    private var enteringHeight: CGFloat { entering.isEmpty ? 0 : 30 + laneHeight * CGFloat(entering.count) }
    private var totalHeight: CGFloat { enteringHeight + rowHeight * CGFloat(stops.count) }

    var body: some View {
        ZStack(alignment: .topLeading) {
            // 진입 구간 레일 (옅게)과 정류장 구간 레일
            if !entering.isEmpty {
                Rectangle()
                    .fill(Theme.route(route).opacity(0.35))
                    .frame(width: 6, height: enteringHeight + rowHeight / 2)
                    .offset(x: railX - 3)
                Text(view.direction == "영통행" ? "고속도로 · 서울로 들어오는 중" : "출발 준비 중")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .offset(x: nameX, y: 8)
            }
            Rectangle()
                .fill(Theme.route(route))
                .frame(width: 6, height: max(0, rowHeight * CGFloat(stops.count - 1)))
                .offset(x: railX - 3, y: enteringHeight + rowHeight / 2)

            // 정류장 줄
            ForEach(Array(stops.enumerated()), id: \.element.id) { index, stop in
                stopRow(stop)
                    .frame(height: rowHeight)
                    .offset(y: enteringHeight + rowHeight * CGFloat(index))
                    .id("stop-\(stop.stationSeq)")
            }

            // 버스 (위치가 바뀌면 레일을 따라 움직인다)
            ForEach(view.buses) { bus in
                busMarker(bus)
                    .offset(y: spreadY(of: bus) - 15)
                    .transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity, minHeight: totalHeight, maxHeight: totalHeight, alignment: .topLeading)
    }

    /// 같은 자리의 버스가 여러 대면 위아래로 벌린다 (먼저 갈 차가 아래)
    private func spreadY(of bus: RouteBus) -> CGFloat {
        let base = y(of: bus)
        let together = view.buses.filter { y(of: $0) == base }.sorted { $0.vehId < $1.vehId }
        guard together.count > 1, let k = together.firstIndex(where: { $0.id == bus.id }) else { return base }
        let gap = min(32, rowHeight * 0.9 / CGFloat(together.count - 1))
        return base + gap * (CGFloat(k) - CGFloat(together.count - 1) / 2)
    }

    private func y(of bus: RouteBus) -> CGFloat {
        if let lane = entering.firstIndex(where: { $0.id == bus.id }) {
            return 30 + laneHeight * (CGFloat(lane) + 0.5)
        }
        guard let index = stops.lastIndex(where: { $0.stationSeq <= bus.currentSeq }) else { return enteringHeight }
        let atStop = stops[index].stationSeq == bus.currentSeq && bus.isAtStop
        return enteringHeight + rowHeight * (CGFloat(index) + (atStop ? 0.5 : 1.0))
    }

    private func stopRow(_ stop: RouteStop) -> some View {
        let isHighlighted = stop.stationSeq == highlighted
        return Button {
            onSelect(stop)
        } label: {
            ZStack(alignment: .topLeading) {
                Rectangle().fill(isHighlighted ? Theme.routeSoft(route).opacity(0.6) : Color.clear)
                Circle()
                    .fill(Theme.card)
                    .frame(width: 14, height: 14)
                    .overlay(Circle().stroke(Theme.route(route), lineWidth: 3))
                    .offset(x: railX - 7, y: rowHeight / 2 - 7)
                HStack(spacing: 6) {
                    Text(stop.stationName)
                        .font(.system(size: 15, weight: isHighlighted ? .heavy : .medium))
                        .foregroundStyle(isHighlighted ? Theme.route(route) : (stop.isTarget ? .primary : .secondary))
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    if stop.isTarget {
                        Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(.tertiary)
                    }
                }
                .frame(height: rowHeight)
                .padding(.leading, nameX)
                .padding(.trailing, 16)
                Rectangle().fill(Theme.hairline.opacity(0.4)).frame(height: 0.5)
                    .offset(x: nameX, y: rowHeight - 0.5)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!stop.isTarget)
        .accessibilityHint(stop.isTarget ? "이 정류장의 탈 확률 보기" : "예측하지 않는 정류장")
    }

    /// 레일 위 버스 아이콘 + 왼쪽에 지금 잔여석·차량번호
    private func busMarker(_ bus: RouteBus) -> some View {
        HStack(spacing: 6) {
            VStack(alignment: .trailing, spacing: 0) {
                Text("\(bus.currentSeats)석")
                    .font(.system(size: 12.5, weight: .heavy))
                    .monospacedDigit()
                    .foregroundStyle(bus.currentSeats == 0 ? Color(hex: 0xB4570A) : .primary)
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
