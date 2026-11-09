# Research

## Conversation Research

| Topic                                    | Papers                                                                                                                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Early assumptions and changing intent    | [LLMs Get Lost In Multi-Turn Conversation](https://arxiv.org/abs/2505.06120); [Intent Mismatch Causes LLMs to Get Lost in Multi-Turn Conversation](https://arxiv.org/abs/2602.07338) |
| Errors carried through bot history       | [Do LLMs Benefit From Their Own Words?](https://arxiv.org/abs/2602.24287)                                                                                                            |
| Group participation and timing           | [MUCA](https://arxiv.org/abs/2401.04883); [HUMA](https://arxiv.org/abs/2511.17315)                                                                                                   |
| Attribution and changing group knowledge | [GroupMemBench](https://arxiv.org/abs/2605.14498); [EverMemBench](https://arxiv.org/abs/2602.01313)                                                                                  |
| Agreement under user pressure            | [Measuring Sycophancy of Language Models in Multi-turn Dialogues](https://arxiv.org/abs/2505.23840)                                                                                  |
| Conversation disentanglement             | [Structural Characterization](https://aclanthology.org/2022.acl-long.23/); [Dynamic Topic Tracking](https://aclanthology.org/2020.emnlp-main.533/)                                   |

## Text Generation

| Source | Relevant implementation |
| ------ | ----------------------- |
| [Witless generator](https://github.com/jieggii/witless/blob/master/api/generator/generator.pyx) | Weighted word transitions, message boundaries, and rejection of copied samples. |
| [Witless routing](https://github.com/jieggii/witless/blob/master/bot/__main__.py) | Probabilistic generation on incoming group messages. |
| [Openglypa generator](https://github.com/ugliestie/openglypa/blob/main/utils/text.py) | Markov generation and output length constraints. |
| [Openglypa routing](https://github.com/ugliestie/openglypa/blob/main/handlers/different_types.py) | Per-chat automatic generation settings. |

## Operations

- [K3s installation](https://docs.k3s.io/quick-start)
- [kubectl cluster configuration and TLS server name](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_config/kubectl_config_set-cluster/)
