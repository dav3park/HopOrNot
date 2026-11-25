import SwiftUI

/// 정류장 화면: AI 판단 → 노선도/지도 → 오는 버스(이번·다음, 더보기) → 탈 확률 높은 정류장 → 지난 7일 도착 잔여석
struct StationView: View {
    @Environment(AppModel.self) private var model
    #if DEBUG
    @State private var view: ViewKind = ProcessInfo.processInfo.arguments.contains("-startMap") ? .map : .strip
    #else
    @State private var view: ViewKind = .strip
    #endif
    @State private var showSettings = false

    enum ViewKind: String, CaseIterable, Identifiable {
        case strip = "노선도", map = "지도"
        var id: String { rawValue }
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                StationContent(view: $view)
            }
            #if DEBUG
            .onChange(of: model.history == nil) {
                // 개발용: -scrollTo history|buses|recommend
                let arguments = ProcessInfo.processInfo.arguments
                if let i = arguments.firstIndex(of: "-scrollTo"), i + 1 < arguments.count, model.history != nil {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { proxy.scrollTo(arguments[i + 1], anchor: .top) }
                }
            }
            #endif
        }
        .background(Theme.background)
        .refreshable { await model.refreshStop() }
        .task(id: "\(model.route?.rawValue ?? "")-\(model.stop?.stationSeq ?? 0)-\(model.mode.rawValue)") {
            // 수집 주기(피크 2분)에 맞춰 1분마다 갱신. 데모는 한 번만.
            while !Task.isCancelled {
                await model.refreshStop()
                #if DEBUG
                SnapshotRenderer.renderStationIfRequested(model: model)
                #endif
                if model.mode == .demo { break }
                try? await Task.sleep(for: .seconds(60))
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showSettings = true } label: { Image(systemName: "gearshape") }
                    .accessibilityLabel("설정")
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showSettings) { SettingsView() }
    }
}

/// 정류장 화면의 내용 (스크롤 안)
struct StationContent: View {
    @Environment(AppModel.self) private var model
    @Binding var view: StationView.ViewKind
    @State private var showAllBuses = false

    var body: some View {
        let decision = model.decision
            VStack(alignment: .leading, spacing: 14) {
                header

                if let error = model.errorMessage {
                    Label(error, systemImage: "exclamationmark.triangle")
                        .font(.system(size: 13))
                        .foregroundStyle(Color(hex: 0xB4570A))
                        .card()
                }

                DecisionCard(decision: decision, stopName: model.stop?.stationName ?? "",
                             nextBusMinutes: model.prediction?.buses.first?.etaMinutes) {
                    if let seq = decision.alternativeSeq { Task { await model.switchStop(to: seq) } }
                }

                if let route = model.route, let line = model.line, let stops = model.routeView?.stops, let mySeq = model.stop?.stationSeq {
                    VStack(alignment: .leading, spacing: 10) {
                        Picker("보기", selection: $view) {
                            ForEach(StationView.ViewKind.allCases) { Text($0.rawValue).tag($0) }
                        }
                        .pickerStyle(.segmented)

                        switch view {
                        case .strip:
                            RouteStripView(route: route, stops: stops, line: line, prediction: model.prediction,
                                           recommendedOrder: decision.recommendedOrder, mySeq: mySeq)
                            ProbabilityLegend(title: "점: 1석 이상")
                                .frame(maxWidth: .infinity)
                        case .map:
                            BusMapView(route: route, stops: stops, segments: model.geometry?.segments ?? [],
                                       otherBuses: model.routeView?.buses ?? [], line: line, prediction: model.prediction,
                                       recommendedOrder: decision.recommendedOrder, mySeq: mySeq)
                                .frame(height: 440)
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                            HStack(spacing: 14) {
                                mapLegend(Theme.route(route), "일반 도로")
                                mapLegend(Theme.highway, "고속도로")
                                Text("핀: 오는 버스 (1 = 이번)").font(.system(size: 11)).foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity)
                        }
                    }
                    .card()
                }

                if let route = model.route, let prediction = model.prediction, !prediction.buses.isEmpty {
                    let total = min(prediction.buses.count, 6)
                    Text("오는 버스").font(.system(size: 17, weight: .bold)).padding(.horizontal, 4).id("buses")
                    ForEach(Array(prediction.buses.prefix(showAllBuses ? total : 2).enumerated()), id: \.element.id) { order, bus in
                        BusCard(route: route, bus: bus, order: order, recommended: order == decision.recommendedOrder)
                    }
                    if total > 2 {
                        Button {
                            withAnimation { showAllBuses.toggle() }
                        } label: {
                            HStack(spacing: 4) {
                                Text(showAllBuses ? "접기" : "버스 \(total - 2)대 더보기")
                                Image(systemName: showAllBuses ? "chevron.up" : "chevron.down")
                            }
                            .font(.system(size: 14, weight: .semibold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                            .background(Theme.card, in: RoundedRectangle(cornerRadius: 14))
                        }
                        .buttonStyle(.plain)
                    }
                }

                if let route = model.route, let recommendation = model.recommendation, recommendation.candidates.count > 1 {
                    RecommendCard(route: route, recommendation: recommendation) { seq in
                        Task { await model.switchStop(to: seq) }
                    }
                    .id("recommend")
                }

                if let route = model.route {
                    if let history = model.history {
                        HistoryCard(route: route, history: history, now: model.prediction?.generatedAt ?? .now)
                            .id("history")
                    } else if model.prediction != nil {
                        ProgressView("지난 7일 도착 잔여석 불러오는 중").font(.system(size: 12)).frame(maxWidth: .infinity).card()
                    }
                }

                footer
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
    }

    private func mapLegend(_ color: Color, _ label: String) -> some View {
        HStack(spacing: 5) {
            RoundedRectangle(cornerRadius: 2).fill(color).frame(width: 16, height: 5)
            Text(label).font(.system(size: 11)).foregroundStyle(.secondary)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let route = model.route {
                HStack(spacing: 10) {
                    RouteBadge(route: route, size: 26)
                    Text("\(model.stop?.stationName ?? "")\(model.stop?.direction.map { " · \($0)" } ?? "")")
                        .font(.system(size: 15, weight: .semibold))
                        .lineLimit(1)
                    Spacer()
                    if model.isLoading { ProgressView().controlSize(.small) }
                }
            }
            LiveDot(label: liveLabel)
        }
        .padding(.horizontal, 4)
    }

    private var liveLabel: String {
        guard let generated = model.prediction?.generatedAt else { return model.dataLabel }
        let stale = model.prediction?.stale == true ? " · 수집이 멈춤" : ""
        return "\(model.dataLabel) · \(Format.time.string(from: generated)) 수집\(stale)"
    }

    private var footer: some View {
        Text("확률은 버스 위치·잔여석과 평소 수요로 예측합니다. 탈 확률은 줄 선 사람(앞차 이후 온 사람, 앞차가 만석이면 남은 사람)을 추정해 계산하며, 도착 시간은 정거장당 약 2분으로 어림합니다.")
            .font(.system(size: 11))
            .foregroundStyle(.tertiary)
            .padding(.horizontal, 4)
    }
}
