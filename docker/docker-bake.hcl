variable "REGISTRY" {
  default = "registry.gitlab.com/cudrx"
}

variable "IMAGE_NAME" {
  default = "telegram-group-command-bot"
}

variable "VERSION" {
  default = "local"
}

variable "NODE_VERSION" {
  default = "24"
}

group "default" {
  targets = ["bot"]
}

group "dev" {
  targets = ["bot-dev-amd64", "bot-dev-arm64"]
}

group "prod" {
  targets = ["bot-prod-amd64", "bot-prod-arm64"]
}

target "bot" {
  name = "bot-${environment}-${arch}"
  matrix = {
    environment = ["dev", "prod"]
    arch = ["amd64", "arm64"]
  }
  context = "."
  dockerfile = "docker/Dockerfile"
  platforms = ["linux/${arch}"]
  args = {
    NODE_VERSION = NODE_VERSION
    NODE_ENV = environment == "prod" ? "production" : "development"
  }
  tags = ["${REGISTRY}/${IMAGE_NAME}:${VERSION}-${environment}-${arch}"]
  cache-from = ["type=registry,ref=${REGISTRY}/${IMAGE_NAME}:cache-${environment}-${arch}"]
  cache-to = ["type=registry,ref=${REGISTRY}/${IMAGE_NAME}:cache-${environment}-${arch},mode=max"]
}
