# 1단계: 빌드 (서버에서 docker compose build 시 실행)
FROM gradle:8.14-jdk21 AS build
WORKDIR /app
ENV GRADLE_OPTS="-Xmx768m -Dorg.gradle.daemon=false"
COPY settings.gradle build.gradle ./
COPY src ./src
RUN gradle bootJar --no-daemon -q

# 2단계: 실행
FROM eclipse-temurin:21-jre
WORKDIR /app
ENV TZ=Asia/Seoul
COPY --from=build /app/build/libs/app.jar app.jar
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
