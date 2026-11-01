# SIX SEVEN PINBALL

Pinball 8-bit com humor de memes. Jogue, acumule **aura**, compre as **7 fichas** na loja e entre no ranking.

**Jogar:** abra `jogo.html` (ou a raiz do site).

## Controles
- **Mouse/toque:** metade esquerda/direita da mesa = mãos (palhetas)
- **Teclado:** `A`/`D` ou setas; `espaço` lança
- **Celular:** botões **6** e **7** nos cantos inferiores, com vibração

## Regras
- 3 bolas. Bumpers, alvos (6-7-67-7-6), spinner, slingshots e portais dão aura e sobem o multiplicador (até x5).
- Derrubar os 5 alvos vale 5.000.
- Perdeu as 3 bolas = fim de jogo; a aura da partida entra no perfil salvo com o seu nome.

## Estrutura
```
jogo.html    entrada (menu + mesa + loja, música única)
index.html   menu (ranking e perfis)
mesa.html    pinball (física, sons, pausa/config)
loja.html    loja das 7 fichas
img/         imagens das fichas
vid/         clipes exibidos na compra
music.mp3    trilha
```

## Desenvolvimento
Projeto do curso FIC de Criação de Jogos (IEEP). A ideia, o tema, os nomes e o visual são da equipe.
Começamos no Construct 2 com o template de pinball
(https://www.construct.net/en/free-online-games/pinball-game-template-88/play) e,
pelas limitações da ferramenta (menu, loja, ranking, layout), migramos para HTML, CSS e JavaScript,
adaptando as partes do template e usando o **DeepSeek** como apoio na programação.
A mesa tem um editor próprio (`mesa.html?edit=1`) para ajustar posição e física dos objetos e exportar a geometria em JSON.

## Equipe
Enoque Mitome · Victor Maia · Jorge Alysson · Larice Maia
