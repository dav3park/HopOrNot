package kr.khu.bus.collector.gbis;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import kr.khu.bus.collector.config.CollectorProperties;
import org.springframework.stereotype.Component;

/** 경기도 버스정보 Open API (v2) 호출. serviceKey 는 Decoding 키를 넣는다. */
@Component
public class GbisClient {

    private static final String BASE = "https://apis.data.go.kr/6410000";

    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();
    private final String serviceKey;

    public GbisClient(CollectorProperties props) {
        String key = props.serviceKey() == null ? "" : props.serviceKey().trim();
        if (key.isEmpty()) {
            throw new IllegalStateException("GBIS_KEY 가 비어 있습니다. .env 를 확인하세요.");
        }
        this.serviceKey = key;
    }

    /** 노선의 운행 중인 모든 차량 위치 + 잔여좌석. */
    public String busLocations(long routeId) throws IOException, InterruptedException {
        return get("/buslocationservice/v2/getBusLocationListv2", "routeId", String.valueOf(routeId));
    }

    /** 노선의 정류장 목록(순번, 회차 여부, 좌표). */
    public String routeStations(long routeId) throws IOException, InterruptedException {
        return get("/busrouteservice/v2/getBusRouteStationListv2", "routeId", String.valueOf(routeId));
    }

    private String get(String path, String paramName, String paramValue)
            throws IOException, InterruptedException {
        String query = "serviceKey=" + enc(serviceKey)
                + "&format=json"
                + "&" + paramName + "=" + enc(paramValue);
        HttpRequest request = HttpRequest.newBuilder(URI.create(BASE + path + "?" + query))
                .timeout(Duration.ofSeconds(15))
                .GET()
                .build();
        HttpResponse<String> response =
                http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (response.statusCode() != 200) {
            throw new IOException("HTTP " + response.statusCode());
        }
        return response.body();
    }

    private static String enc(String v) {
        return URLEncoder.encode(v, StandardCharsets.UTF_8);
    }
}
