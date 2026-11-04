package kr.khu.bus.collector.config;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * application.yml 의 collector.* 설정.
 *
 * windows: 하루 중 수집 구간. 구간 밖 시간에는 수집하지 않는다.
 *   start/end 는 "HH:mm" (end 는 "24:00" 허용), intervalSeconds 는 수집 간격.
 */
@ConfigurationProperties(prefix = "collector")
public record CollectorProperties(
        String zone,
        String serviceKey,
        int dailyLimit,
        String storeRawUntil,
        String discordWebhook,
        List<Route> routes,
        List<Window> windows) {

    public record Route(String name, long routeId) {}

    public record Window(String start, String end, int intervalSeconds) {}
}
