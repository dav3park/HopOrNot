import SwiftUI

/// 노선 선택 (design/ 프로토타입의 노선 카드) → 방향 → 정류장
struct StopPickerView: View {
    @Environment(AppModel.self) private var model
    @State private var showSettings = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("경희대학교 국제캠퍼스 광역버스")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.secondary)
                    Text("노선 선택")
                        .font(.system(size: 34, weight: .heavy))
                        .tracking(-0.4)
                }
                .padding(.horizontal, 4)

                VStack(spacing: 12) {
                    ForEach(Route.allCases) { route in
                        NavigationLink(value: route) { routeCard(route) }
                            .buttonStyle(.plain)
                    }
                }

                LiveDot(label: "\(model.dataLabel) · 탈 확률은 내 정류장 기준 예측")
                    .frame(maxWidth: .infinity)
            }
            .padding(16)
        }
        .background(Theme.background)
        .navigationDestination(for: Route.self) { StopListView(route: $0) }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showSettings = true } label: { Image(systemName: "gearshape") }
                    .accessibilityLabel("설정")
            }
        }
        .sheet(isPresented: $showSettings) { SettingsView() }
    }

    private func routeCard(_ route: Route) -> some View {
        HStack(spacing: 14) {
            Image(systemName: "bus.fill")
                .font(.system(size: 24))
                .foregroundStyle(.white)
                .frame(width: 52, height: 52)
                .background(Theme.route(route), in: RoundedRectangle(cornerRadius: 14))
            VStack(alignment: .leading, spacing: 4) {
                RouteBadge(route: route)
                Text("\(route.terminals.0) ↔ \(route.terminals.1)")
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold)).foregroundStyle(.tertiary)
        }
        .padding(16)
        .frame(minHeight: 88)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

struct StopListView: View {
    let route: Route
    @Environment(AppModel.self) private var model
    @State private var stops: [StopInfo] = []
    @State private var direction = "영통행"
    @State private var search = ""
    @State private var error: String?

    private var shown: [StopInfo] {
        stops.filter { $0.direction == direction && (search.isEmpty || $0.stationName.contains(search)) }
    }

    var body: some View {
        List {
            Section {
                Picker("방향", selection: $direction) {
                    Text("서울행 (출근)").tag("서울행")
                    Text("영통행 (퇴근)").tag("영통행")
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }
            if let error {
                Text(error).foregroundStyle(.secondary)
            }
            Section {
                ForEach(shown) { stop in
                    Button {
                        model.select(route: route, stop: stop)
                    } label: {
                        HStack {
                            Text(stop.stationName).foregroundStyle(.primary)
                            Spacer()
                            Text(stop.supportsMySeat ? "탈 확률" : "좌석 확률만")
                                .font(.system(size: 11, weight: .semibold))
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .foregroundStyle(stop.supportsMySeat ? Theme.accent : .secondary)
                                .background(stop.supportsMySeat ? Color(hex: 0xEAF1FB) : Color(.tertiarySystemFill),
                                            in: RoundedRectangle(cornerRadius: 5))
                        }
                    }
                }
            } footer: {
                Text("탈 확률(줄 선 사람까지 반영)은 승차가 많은 구간에서만 나옵니다. 그 밖의 정류장은 버스에 자리가 남을 확률만 보여줍니다.")
            }
        }
        .navigationTitle(route.rawValue)
        .searchable(text: $search, prompt: "정류장 검색")
        .task {
            do { stops = try await model.source.stops(route: route) } catch { self.error = error.localizedDescription }
        }
    }
}
