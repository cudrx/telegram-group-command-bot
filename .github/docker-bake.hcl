variable "IMAGE_PREFIX" { default = "telegram-group-command-bot" }
variable "IMAGE_TAG" { default = "local" }

group "default" { targets = ["bot", "video", "gallery"] }

target "common" {
  context = "."
  dockerfile = ".github/Dockerfile"
}

target "bot" {
  inherits = ["common"]
  target = "bot"
  tags = ["${IMAGE_PREFIX}:${IMAGE_TAG}"]
  cache-from = ["type=gha,scope=bot"]
  cache-to = ["type=gha,scope=bot,mode=max"]
}

target "video" {
  inherits = ["common"]
  target = "video"
  tags = ["${IMAGE_PREFIX}-video:${IMAGE_TAG}"]
  cache-from = ["type=gha,scope=video"]
  cache-to = ["type=gha,scope=video,mode=max"]
}

target "gallery" {
  inherits = ["common"]
  target = "gallery"
  tags = ["${IMAGE_PREFIX}-gallery:${IMAGE_TAG}"]
  cache-from = ["type=gha,scope=gallery"]
  cache-to = ["type=gha,scope=gallery,mode=max"]
}
