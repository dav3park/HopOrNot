import SwiftUI

/// 정류장 화면: AI 판단 → 노선도/지도 → 오는 버스 → 탈 확률 높은 정류장
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
        ScrollView {
            StationContent(view: $view)
        }
        .background(Theme.background)
        .refreshable { await model.refresh() }
        .task(id: "\(model.route?.rawValue ?? "")-\(model.stop?.stationSeq ?? 0)-\(model.mode.rawValue)") {
            // 수집 주기(피크 2분)에 맞춰 1분마다 갱신. 데모는 한 번만.
            while !Task.isCancelled {
                await model.refresh()
                #if DEBUG
                SnapshotRenderer.renderIfRequested(model: model)
                #endif
                if model.mode == .demo { break }
                try? await Task.sleep(for: .seconds(60))
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button { model.clearSelection() } label: {
                    Label("정류장", systemImage: "chevron.left").labelStyle(.titleAndIcon)
                }
            }
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

                if let route = model.route, let line = model.line {
                    VStack(alignment: .leading, spacing: 10) {
                        Picker("보기", selection: $view) {
                            ForEach(StationView.ViewKind.allCases) { Text($0.rawValue).tag($0) }
                        }
                        .pickerStyle(.segmented)

                        switch view {
                        case .strip:
                            RouteStripView(route: route, line: line, prediction: model.prediction,
                                           recommendedOrder: decision.recommendedOrder)
                        case .map:
                            BusMapView(route: route, line: line, prediction: model.prediction,
                                       recommendedOrder: decision.recommendedOrder)
                                .frame(height: 360)
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                        }
                        ProbabilityLegend(title: view == .strip ? "점: 1석 이상" : "탈 확률")
                            .frame(maxWidth: .infinity)
                    }
                    .card()
                }

                if let route = model.route, let prediction = model.prediction, !prediction.buses.isEmpty {
                    Text("오는 버스").font(.system(size: 17, weight: .bold)).padding(.horizontal, 4)
                    ForEach(Array(prediction.buses.prefix(5).enumerated()), id: \.element.id) { order, bus in
                        BusCard(route: route, bus: bus, order: order, recommended: order == decision.recommendedOrder)
                    }
                }

                if let route = model.route, let recommendation = model.recommendation, recommendation.candidates.count > 1 {
                    RecommendCard(route: route, recommendation: recommendation) { seq in
                        Task { await model.switchStop(to: seq) }
                    }
                }

                footer
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let route = model.route {
                HStack(spacing: 10) {
                    RouteBadge(route: route, size: 30)
                    Text("\(model.stop?.direction ?? "") 방면")
                        .font(.system(size: 14))
                        .foregroundStyle(.secondary)
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
