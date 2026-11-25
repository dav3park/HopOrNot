import MapKit
import SwiftUI

/// 지도: 노선 경로 위에 다가오는 버스와 내 정류장. 주변 장소는 숨겨 노선과 버스만 보이게 한다.
/// 노선은 경기버스 공식 지도의 도로 경로다 (서버가 버스들과 내 정류장 사이 구간만 잘라 준다).
/// 버스 위치는 GPS가 아니라 버스가 지난 정류장 기준이다 (도착해 있으면 그 정류장, 가는 중이면 다음 정류장까지 도로의 중간).
struct BusMapView: View {
    let route: Route
    let line: LineView
    let prediction: Prediction?
    let recommendedOrder: Int?

    @State private var position: MapCameraPosition = .automatic

    private var buses: [LineBus] { Array(line.buses.prefix(4)) }


    var body: some View {
        Map(position: $position) {
            MapPolyline(coordinates: line.path.map { coordinate($0[0], $0[1]) })
                .stroke(Theme.route(route).opacity(0.7), lineWidth: 5)

            // 중간 정류장 점은 버스 핀을 가려서 그리지 않는다. 정류장별 확률은 노선도에서 본다.
            ForEach(line.stops.filter(\.isMine)) { stop in
                Annotation(stop.stationName, coordinate: coordinate(stop.lat, stop.lon), anchor: .center) {
                    Image(systemName: "mappin.circle.fill")
                        .font(.system(size: 24))
                        .foregroundStyle(.white, Theme.route(route))
                }
            }

            ForEach(buses) { bus in
                Annotation("", coordinate: coordinate(bus.lat, bus.lon), anchor: .center) {
                    busPin(bus)
                }
            }
        }
        .mapStyle(.standard(pointsOfInterest: .excludingAll))
        .onAppear { position = .region(region) }
        .onChange(of: line.stationSeq) { position = .region(region) }
    }

    private func busPin(_ bus: LineBus) -> some View {
        let byHere = prediction?.mySeat?.byBus.flatMap { bus.order < $0.count ? $0[bus.order] : nil }
        let recommended = bus.order == recommendedOrder
        return HStack(spacing: 4) {
            Image(systemName: "bus.fill")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 22, height: 22)
                .background(Theme.route(route), in: Circle())
            VStack(alignment: .leading, spacing: 0) {
                Text(Decision.ordinal(bus.order)).font(.system(size: 9, weight: .semibold)).foregroundStyle(.secondary)
                Text(byHere.map(Format.percent) ?? "\(bus.currentSeats)석")
                    .font(.system(size: 12, weight: .heavy))
                    .monospacedDigit()
                    .foregroundStyle(byHere.map(Theme.text) ?? .primary)
            }
        }
        .padding(.leading, 2).padding(.trailing, 7).padding(.vertical, 2)
        .background(.background, in: Capsule())
        .overlay(Capsule().stroke(recommended ? Theme.accent : Color.clear, lineWidth: 2))
        .shadow(color: .black.opacity(0.15), radius: 3, y: 1)
    }

    private func coordinate(_ lat: Double, _ lon: Double) -> CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }

    /// 내 정류장 앞쪽 정류장들과 버스가 모두 보이는 범위
    private var region: MKCoordinateRegion {
        let points = line.path.map { ($0[0], $0[1]) } + buses.map { ($0.lat, $0.lon) }
        let lats = points.map(\.0), lons = points.map(\.1)
        guard let minLat = lats.min(), let maxLat = lats.max(), let minLon = lons.min(), let maxLon = lons.max() else {
            return MKCoordinateRegion(center: coordinate(37.5665, 126.978), span: .init(latitudeDelta: 0.05, longitudeDelta: 0.05))
        }
        return MKCoordinateRegion(
            center: coordinate((minLat + maxLat) / 2, (minLon + maxLon) / 2),
            span: .init(latitudeDelta: max(0.008, (maxLat - minLat) * 1.35), longitudeDelta: max(0.008, (maxLon - minLon) * 1.35)))
    }
}
