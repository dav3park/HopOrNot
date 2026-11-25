import SwiftUI

/// 노선 화면 (네이버 버스처럼): 한 방향의 정류장 목록 위에 지금 달리는 버스를 놓는다.
/// 정류장을 누르면 내 정류장이 되고, 위에 AI 판단이 고정되며, 내 정류장으로 오는 버스 옆에 탈 확률이 붙는다.
struct RouteScreen: View {
    let route: Route
    @Environment(AppModel.self) private var model
    @State private var showDetail = false
    @State private var showMap = false
    @State private var showSettings = false
    @State private var scrolledTo: Int?

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                RouteContent(route: route)
            }
            .background(Theme.background)
            .safeAreaInset(edge: .top, spacing: 0) {
                PinnedDecision { showDetail = true }
                    .padding(.horizontal, 12)
                    .padding(.bottom, 6)
                    .background(Theme.background.opacity(0.96))
            }
            .refreshable { await model.refresh() }
            .onChange(of: model.routeView?.generatedAt) { scrollToStop(proxy) }
            .onChange(of: model.stop?.stationSeq) { scrollToStop(proxy, animated: true) }
        }
        .task(id: "\(route.rawValue)-\(model.direction)-\(model.stop?.stationSeq ?? 0)-\(model.mode.rawValue)") {
            // 수집 주기(피크 2분)에 맞춰 1분마다 갱신. 데모는 한 번만.
            while !Task.isCancelled {
                await model.refresh()
                #if DEBUG
                SnapshotRenderer.renderIfRequested(model: model, route: route)
                #endif
                if model.mode == .demo { break }
                try? await Task.sleep(for: .seconds(60))
            }
        }
        .onAppear { model.open(route) }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text(route.rawValue).font(.system(size: 19, weight: .heavy))
            }
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button { showMap = true } label: { Image(systemName: "map") }
                    .disabled(model.line == nil)
                    .accessibilityLabel("지도")
                Button { showSettings = true } label: { Image(systemName: "gearshape") }
                    .accessibilityLabel("설정")
            }
        }
        .sheet(isPresented: $showDetail) {
            StationDetailView()
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $showMap) { MapSheet(route: route) }
        .sheet(isPresented: $showSettings) { SettingsView() }
    }

    private func scrollToStop(_ proxy: ScrollViewProxy, animated: Bool = false) {
        guard let seq = model.stop?.stationSeq, model.routeView != nil, seq != scrolledTo || animated else { return }
        scrolledTo = seq
        if animated {
            withAnimation { proxy.scrollTo("stop-\(seq)", anchor: .center) }
        } else {
            proxy.scrollTo("stop-\(seq)", anchor: .center)
        }
    }
}

/// 노선 화면 스크롤 내용 (스냅샷에서도 쓴다)
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
                    if model.isLoading { ProgressView().controlSize(.small) }
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
                StopList(route: route, view: view)
                    .background(Theme.card)
            } else {
                ProgressView().frame(maxWidth: .infinity).padding(40)
            }

            Text("버스 옆 %는 내 정류장까지 그 버스로(앞 버스를 보내는 경우 포함) 탈 확률입니다. 줄 선 사람을 추정해 계산하며, 버스 위치는 마지막으로 지난 정류장 기준입니다.")
                .font(.system(size: 11))
                .foregroundStyle(.tertiary)
                .padding(16)
        }
    }

    private var liveLabel: String {
        guard let generated = model.routeView?.generatedAt else { return model.dataLabel }
        return "\(model.dataLabel) · \(Format.time.string(from: generated)) 수집"
    }
}

/// 정류장 목록: 세로 레일 위에 정류장 점, 정류장 사이와 정류장 위에 버스
struct StopList: View {
    let route: Route
    let view: RouteView
    @Environment(AppModel.self) private var model

    private var myIndex: Int? { view.stops.firstIndex { $0.stationSeq == model.stop?.stationSeq } }

    var body: some View {
        let stops = view.stops
        LazyVStack(spacing: 0) {
            // 이 방향 첫 정류장으로 오는 중 (고속도로, 캠퍼스 안쪽). 먼 버스가 위
            let entering = view.buses.filter { $0.currentSeq < (stops.first?.stationSeq ?? 0) }
            if !entering.isEmpty {
                Text(model.direction == "영통행" ? "고속도로에서 서울로 들어오는 중" : "출발 준비 중")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.leading, 54).padding(.top, 10).padding(.bottom, 2)
                ForEach(entering) { bus in
                    BusRow(route: route, bus: bus, info: info(for: bus), dimmed: false,
                           note: bus.placeShort.isEmpty ? "진입 중" : "\(bus.placeShort) 지남")
                }
            }
            ForEach(Array(stops.enumerated()), id: \.element.id) { index, stop in
                let next = index + 1 < stops.count ? stops[index + 1].stationSeq : Int.max
                let arrived = view.buses.filter { $0.currentSeq == stop.stationSeq && $0.isAtStop }
                let moving = view.buses.filter {
                    $0.currentSeq >= stop.stationSeq && $0.currentSeq < next && !($0.currentSeq == stop.stationSeq && $0.isAtStop)
                }
                StopRow(route: route, stop: stop, isMine: index == myIndex, isAfterMine: myIndex.map { index > $0 } ?? false,
                        isFirst: index == 0, isLast: index == stops.count - 1,
                        arrived: arrived.map { ($0, info(for: $0)) }) {
                    if stop.isTarget { model.select(stop.info) }
                }
                .id("stop-\(stop.stationSeq)")
                ForEach(moving) { bus in
                    BusRow(route: route, bus: bus, info: info(for: bus), dimmed: myIndex.map { index >= $0 } ?? false, note: nil)
                }
            }
        }
    }

    /// 내 정류장이 있으면, 그 버스로 내 정류장에서 탈 확률 (가까운 몇 대는 앞 버스를 보내는 경우까지 누적)
    private func info(for bus: RouteBus) -> BusProbability? {
        guard model.stop != nil, let prediction = model.prediction,
              let order = prediction.buses.firstIndex(where: { $0.vehId == bus.vehId }) else { return nil }
        let predicted = prediction.buses[order]
        if let byHere = predicted.mySeatByHere {
            return BusProbability(order: order, value: byHere, label: "탈 확률")
        }
        return predicted.atLeast(1).map { BusProbability(order: order, value: $0, label: "1석 이상") }
    }
}

struct BusProbability {
    let order: Int
    let value: Double
    let label: String
}

/// 세로 레일 한 칸: 위아래 선 + 가운데 표시
private struct Rail<Mark: View>: View {
    let color: Color
    var topVisible = true
    var bottomVisible = true
    var faded = false
    @ViewBuilder let mark: Mark

    var body: some View {
        ZStack {
            VStack(spacing: 0) {
                Rectangle().fill(topVisible ? color : .clear)
                Rectangle().fill(bottomVisible ? color.opacity(faded ? 0.3 : 1) : .clear)
            }
            .frame(width: 5)
            mark
        }
        .frame(width: 44)
    }
}

struct StopRow: View {
    let route: Route
    let stop: RouteStop
    let isMine: Bool
    let isAfterMine: Bool
    let isFirst: Bool
    let isLast: Bool
    let arrived: [(RouteBus, BusProbability?)]
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(alignment: .center, spacing: 10) {
                Rail(color: Theme.route(route).opacity(isAfterMine ? 0.3 : 1), topVisible: !isFirst, bottomVisible: !isLast,
                     faded: isMine) {
                    if let first = arrived.first {
                        BusIcon(route: route, dimmed: isAfterMine)
                            .accessibilityLabel("\(first.0.plateShort) 도착")
                    } else {
                        Circle()
                            .fill(isMine ? Theme.route(route) : Theme.card)
                            .frame(width: isMine ? 18 : 13, height: isMine ? 18 : 13)
                            .overlay(Circle().stroke(Theme.route(route).opacity(isAfterMine ? 0.4 : 1), lineWidth: isMine ? 0 : 3))
                    }
                }
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(stop.stationName)
                            .font(.system(size: 15, weight: isMine ? .heavy : .medium))
                            .foregroundStyle(isMine ? Theme.route(route) : (stop.isTarget ? .primary : .secondary))
                            .lineLimit(1)
                        if isMine {
                            Text("내 정류장")
                                .font(.system(size: 10, weight: .bold))
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .foregroundStyle(.white)
                                .background(Theme.route(route), in: RoundedRectangle(cornerRadius: 5))
                        }
                    }
                    ForEach(arrived, id: \.0.id) { bus, probability in
                        BusLabel(bus: bus, probability: probability, note: "도착", dimmed: isAfterMine)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.trailing, 16)
            .frame(minHeight: 54)
            .background(isMine ? Theme.routeSoft(route).opacity(0.6) : .clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!stop.isTarget)
        .accessibilityHint(stop.isTarget ? "내 정류장으로 정하기" : "예측하지 않는 정류장")
    }
}

/// 정류장 사이를 달리는 버스 한 대
struct BusRow: View {
    let route: Route
    let bus: RouteBus
    let info: BusProbability?
    let dimmed: Bool
    let note: String?

    var body: some View {
        HStack(spacing: 10) {
            Rail(color: Theme.route(route).opacity(dimmed ? 0.3 : 1)) {
                BusIcon(route: route, dimmed: dimmed)
            }
            BusLabel(bus: bus, probability: info, note: note, dimmed: dimmed)
            Spacer(minLength: 0)
        }
        .padding(.trailing, 16)
        .frame(minHeight: 40)
        .accessibilityElement(children: .combine)
    }
}

struct BusIcon: View {
    let route: Route
    var dimmed = false
    var body: some View {
        Image(systemName: "bus.fill")
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(.white)
            .frame(width: 26, height: 26)
            .background(dimmed ? Color(.systemGray3) : Theme.route(route), in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.card, lineWidth: 2))
    }
}

/// 버스 옆 글자: 차량번호 · 지금 잔여석, 내 정류장이 있으면 탈 확률
struct BusLabel: View {
    let bus: RouteBus
    let probability: BusProbability?
    let note: String?
    let dimmed: Bool

    var body: some View {
        HStack(spacing: 6) {
            if let probability {
                Text(Decision.ordinal(probability.order))
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(.secondary)
            }
            Text([note, bus.plateShort, "지금 \(bus.currentSeats)석"].compactMap { $0 }.joined(separator: " · "))
                .font(.system(size: 12.5))
                .foregroundStyle(dimmed ? .tertiary : .secondary)
                .lineLimit(1)
            if let probability, !dimmed {
                HStack(spacing: 3) {
                    Text(probability.label).font(.system(size: 10.5))
                    Text(Format.percent(probability.value)).font(.system(size: 13, weight: .heavy)).monospacedDigit()
                }
                .padding(.horizontal, 7).padding(.vertical, 3)
                .foregroundStyle(Theme.text(probability.value))
                .background(Theme.tint(probability.value), in: Capsule())
                .lineLimit(1)
                .layoutPriority(1)
            }
        }
    }
}

/// 위에 고정되는 AI 판단 (누르면 상세)
struct PinnedDecision: View {
    @Environment(AppModel.self) private var model
    let onTap: () -> Void

    var body: some View {
        if let stop = model.stop, model.prediction != nil {
            let decision = model.decision
            Button(action: onTap) {
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(stop.stationName) · AI 판단")
                            .font(.system(size: 11.5, weight: .semibold))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                        Text(decision.headline)
                            .font(.system(size: 18, weight: .heavy))
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                        Text(decision.detail)
                            .font(.system(size: 12))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 4)
                    VStack(alignment: .trailing, spacing: 0) {
                        Text(decision.probabilityLabel).font(.system(size: 10.5)).foregroundStyle(.secondary)
                        Text(decision.probability.map(Format.percent) ?? "–")
                            .font(.system(size: 28, weight: .heavy))
                            .monospacedDigit()
                            .foregroundStyle(decision.probability.map(Theme.text) ?? .secondary)
                    }
                    Image(systemName: "chevron.up").font(.system(size: 12, weight: .semibold)).foregroundStyle(.tertiary)
                }
                .padding(12)
                .background(Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .shadow(color: .black.opacity(0.08), radius: 6, y: 2)
            }
            .buttonStyle(.plain)
            .accessibilityHint("버스별 좌석 확률과 탈 확률 높은 정류장 보기")
        } else if model.stop == nil, model.routeView != nil {
            Label("정류장을 누르면 탈 확률을 알려드려요", systemImage: "hand.tap")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.accent)
                .frame(maxWidth: .infinity)
                .padding(10)
                .background(Color(hex: 0xEAF1FB), in: RoundedRectangle(cornerRadius: 12))
        }
    }
}

/// 지도 (보조): 내 정류장 주변 노선과 오는 버스
struct MapSheet: View {
    let route: Route
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if let line = model.line {
                    BusMapView(route: route, line: line, prediction: model.prediction,
                               recommendedOrder: model.decision.recommendedOrder)
                        .ignoresSafeArea(edges: .bottom)
                } else {
                    ContentUnavailableView("정류장을 먼저 고르세요", systemImage: "mappin.and.ellipse")
                }
            }
            .navigationTitle(model.stop.map { "\($0.stationName) 가는 버스" } ?? "지도")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("닫기") { dismiss() } } }
        }
    }
}
