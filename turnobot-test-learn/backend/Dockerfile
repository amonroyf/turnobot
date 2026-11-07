FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum* ./
COPY sandbox ./sandbox
COPY backend ./backend
RUN go mod download
RUN CGO_ENABLED=0 go build -o /out/server ./backend

FROM gcr.io/distroless/base-debian12
COPY --from=build /out/server /server
EXPOSE 8080
ENTRYPOINT ["/server"]
