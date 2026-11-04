package kr.khu.bus.collector.notify;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import kr.khu.bus.collector.config.CollectorProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * 이벤트를 collector_event 테이블에 남기고, 디스코드 웹훅이 설정돼 있으면 알림을 보낸다.
 * 같은 key 의 알림은 1시간에 한 번만 보낸다.
 */
@Component
public class Notifier {

    private static final Logger log = LoggerFactory.getLogger(Notifier.class);
    private static final Duration DEDUPE = Duration.ofHours(1);

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final String webhook;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private final Map<String, Instant> lastSent = new ConcurrentHashMap<>();

    public Notifier(JdbcTemplate jdbc, ObjectMapper mapper, CollectorProperties props) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.webhook = props.discordWebhook() == null ? "" : props.discordWebhook().trim();
    }

    public void info(String key, String message) {
        write("INFO", key, message);
    }

    public void alert(String key, String message) {
        write("ALERT", key, message);
    }

    private void write(String level, String key, String message) {
        if ("ALERT".equals(level)) log.warn("[{}] {}", key, message); else log.info("[{}] {}", key, message);
        try {
            jdbc.update("INSERT INTO collector_event (level, event_key, message) VALUES (?, ?, ?)",
                    level, key, message);
        } catch (Exception e) {
            log.warn("이벤트 저장 실패: {}", e.getMessage());
        }

        Instant now = Instant.now();
        Instant prev = lastSent.get(key);
        if (webhook.isEmpty() || (prev != null && prev.plus(DEDUPE).isAfter(now))) {
            return;
        }
        lastSent.put(key, now);
        try {
            String content = (("ALERT".equals(level) ? "🚨 " : "ℹ️ ") + "[bus-collector] " + message);
            if (content.length() > 1900) content = content.substring(0, 1900);
            String json = mapper.writeValueAsString(Map.of("content", content));
            HttpRequest req = HttpRequest.newBuilder(URI.create(webhook))
                    .timeout(Duration.ofSeconds(10))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(json))
                    .build();
            http.send(req, HttpResponse.BodyHandlers.discarding());
        } catch (Exception e) {
            log.warn("디스코드 알림 실패: {}", e.getMessage());
        }
    }
}
