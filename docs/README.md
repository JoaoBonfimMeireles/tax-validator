# Validador de Impostos (SAP)

App de admin da VTEX que consulta a Tax API da Whirlpool para simular os impostos de um produto, usando dados do catálogo, da simulação de frete e do centro de custo (CEP) da organização B2B associada ao SAP ID informado.

## Uso

1. Acesse `/admin/tax-validator`.
2. Informe o SAP ID, o skuId ou refId do produto e o preço.
3. Clique em "Consultar impostos".

## Configuração

Em Apps > Meus apps > Validador de Impostos > Configurações, informe:

- **BASIC**: client_id:secret em Base64 para autenticar na Tax API da Whirlpool.
- **URL do token** e **URL da Tax API**: endpoints da Whirlpool (já vêm com valor padrão).
