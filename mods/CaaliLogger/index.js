const   fs = require('fs'),
        path = require('path'),
        zlib = require('zlib'),
        crypto = require('crypto'),
        request = require('request');

const UploadServerURLs = ['https://teralogs.lima-city.de/'];

class CaaliLogger {
    constructor(mod) {
        this.mod = mod;
        this.isOnServerEmulator = false;
        this.StateTracker = mod.require.CaaliStateTracker;
        this.reset();
        this.installHooks(mod);
    }

    destructor()
    {
        this.finishSession();
    }

    installHook(mod, name, version, cb)
    {
        mod.hook(name, version, {order: -999, filter: {fake: false, modified: false, silenced: null}}, cb);
    }

    installHookBeforeTracker(mod, name, version, cb)
    {
        mod.hook(name, version, {order: -1001, filter: {fake: false, modified: false, silenced: null}}, cb);
    }

    installHooks(mod)
    {
        this.installHook(mod, 'S_LOGIN_ACCOUNT_INFO', 2, (event) => {
            this.isOnServerEmulator = event.serverName.includes('ServerEmulator');
        })

        this.installHook(mod, 'S_QUEST_BALLOON', 1, (event) => {
            let npc = this.StateTracker.SpawnedNPCs[event.source.toString()]
            if(npc != null)
            {
                let dataId = npc["huntingZoneId"] + "," + npc["templateId"];
                if(this.LoggedData["aimsg"][dataId] == undefined)
                    this.LoggedData["aimsg"][dataId] = [];

                this.LoggedData["aimsg"][dataId].push({
                    "time": Date.now(),
                    "msg": event.message,
                    "status": npc["status"],
                });
            }
        })

        if (mod.majorPatchVersion >= 61) {
            this.installHook(mod, 'S_REGISTER_ENCHANT_ITEM', 2, (event) => {
                this.LoggedData["enchant"].push({
                    "id": event.itemId,
                    "upgrade": event.enableUpgrade,
                    "masterwork": event.masterwork,
                    "masterworkBonus": event.masterworkBonus,
                    "enchant": event.enchantLevel,
                    "enchantmax": event.enchantLevelMax,
                    "iexp": event.itemEXP.toString(),
                    "ilvl": event.itemLevel,
                    "ilvlMax": event.itemLevelMax,
                    "price": event.price.toString(),
                    "chances": event.successChances,
                    "materials": event.materials,
                    "hideSuccessChance": event.hideSuccessChance,
                    "downgradeOnFailureChance": event.downgradeOnFailureChance,
                    "damageOnFailureChance": event.damageOnFailureChance,
                })
            })
        }

        if (mod.majorPatchVersion >= 79) {
            this.installHook(mod, 'S_REGISTER_EVOLUTION_ITEM', 2, (event) => {
                this.LoggedData["upgrade"].push({
                    "sourceId": event.sourceItemId,
                    "sourceEnchant": event.sourceEnchantLevel,
                    "sourceIlvl": event.sourceItemLevel,
                    "sourceIlvlMax": event.sourceItemLevelMax,
                    "resultId": event.resultItemId,
                    "resultEnchant": event.resultEnchantLevel,
                    "resultIlvl": event.resultItemLevel,
                    "resultIlvlMax": event.resultItemLevelMax,
                    "iexp": event.itemEXP.toString(),
                    "masterwork": event.masterwork,
                    "masterworkBonus": event.masterworkBonus,
                    "price": event.price.toString(),
                    "chances": event.successChances,
                    "materials": event.materials,
                    "hideSuccessChance": event.hideSuccessChance,
                    "destroyOnFailureChance": event.destroyOnFailureChance,
                    "damageOnFailureChance": event.damageOnFailureChance,
                })
            })
        }

        this.installHook(mod, 'S_LOGIN', mod.majorPatchVersion >= 81 ? 13 : 12, (event) => {
            this.LoggedData["starttime"] = Date.now();
            this.LoggedData["templateId"] = event.templateId;
        })

        this.installHook(mod, 'C_REVIVE_NOW', 1, (event) => {
            if(event.type == 0)
                this.SafeHavenResActive = true;
        })

        this.installHook(mod, 'S_CREATURE_LIFE', 2, (event) => {
            if(event.gameId.toString() == this.StateTracker.MyID && !event.alive)
                this.CurDeathLocation = {'continent': this.StateTracker.MyContinent, 'x': event.loc.x, 'y': event.loc.y, 'z': event.loc.z};
        })

        this.installHook(mod, 'S_LOAD_TOPO', 3, (event) => {
            if(this.SafeHavenResActive && this.CurDeathLocation)
            {
                this.LoggedData["reslocs"].push({
                    "from": this.CurDeathLocation,
                    "to": {
                        "continent": event.zone,
                        "x": event.loc.x,
                        "y": event.loc.y,
                        "z": event.loc.z,
                    }
                })

                this.SafeHavenResActive = false;
            }
            else if(this.LastTeleportalID != null && this.LastTeleportalTime + 20000 >= Date.now())
            {
                this.LoggedData["teleportals"][this.LastTeleportalID] = {
                    "destination": {
                        "continent": event.zone,
                        "x": event.loc.x,
                        "y": event.loc.y,
                        "z": event.loc.z,
                    }
                }
            }

            this.LastGatheringNodePicked = null;
            this.LastGatheringNodePickTime = null;
            this.LastDialogButtons = null;
            this.LastDialogButtonTime = null;
            this.LastDialogButton = null;
            this.LastTeleportalID = null;
            this.LastTeleportalTime = null;
            this.LastUseItemEvent = null;
            this.LastUseItemTime = null;
            this.HasOpenedLootBox = false;
            this.LastGachaContract = null;
            this.LastGachaItem = null;
            this.LastGachaActive = false;
        })

        this.installHook(mod, 'S_SPAWN_NPC', 11, (event) => {
            // We don't want billions of fish spawn points
            if (event.templateId === 9901 && [61, 62, 83, 207, 223, 230].includes(event.huntingZoneId))
                return;

            this.LoggedData["spawns"]["npcs"].push({
                "id": event.huntingZoneId + ',' + event.templateId,
                "continent": this.StateTracker.MyContinent,
                "x": event.loc.x,
                "y": event.loc.y,
                "z": event.loc.z,
                "w": event.w,
                "scan": event.aggressive,
                "walk": event.walkSpeed,
                "run": event.runSpeed,
                "name": event.npcName,
                "unknV75": event.unkn1,
            });
        })

        if (mod.platform !== 'classic') {
            this.installHookBeforeTracker(mod, 'S_NPC_STATUS', 2, (event) => {
                if(!event.enraged)
                    return;

                let npc = this.StateTracker.SpawnedNPCs[event.gameId.toString()]
                if(npc != null && !npc['enraged']) {
                    const id = npc["huntingZoneId"] + "," + npc["templateId"];
                    if(!this.LoggedData["npcenrage"][id])
                        this.LoggedData["npcenrage"][id] = [];

                    this.LoggedData["npcenrage"][id].push({
                        "hp": (npc["hp"] || -1).toString(),
                        "time": event.remainingEnrageTime
                    })
                }
            })
        }

        this.installHook(mod, 'S_DESPAWN_NPC', 3, (event) => {
            let cid = event.gameId.toString();
            let npc = this.StateTracker.SpawnedNPCs[cid]
            if (npc && event.type != 1)
            {
                // We don't want billions of fish "kills" either...
                if (npc['templateId'] === 9901 && [61, 62, 83, 207, 223, 230].includes(npc['huntingZoneId']))
                    return;

                this.LoggedData["kills"][cid] = {
                    "id": npc['huntingZoneId'] + ',' + npc['templateId'],
                    "occupierlevel": npc['occupierLevel'],
                    "drops": [],
                }
            }
        })

        this.installHook(mod, 'S_PLAYER_CHANGE_EXP', 1, (event) => {
            let npc = this.StateTracker.SpawnedNPCs[event.killedMob.toString()]
            if(npc != null) {
                this.LoggedData["exp"].push({
                    "id": npc["huntingZoneId"] + "," + npc["templateId"],
                    "playerlevel": this.StateTracker.SpawnedPlayers[this.StateTracker.MyID]['level'],
                    "total": event.gainedTotalEXP.toString(),
                    "rested": event.gainedRestedEXP,
                    "unk2": event.unk2,
                    "unk3": event.unk3,
                    "unk4": event.unk4,
                    "abnormalityset_id": this.storeAbnormalities(this.StateTracker.SpawnedPlayers[this.StateTracker.MyID]['abnormalities']),
                })
            }
        })

        this.installHook(mod, 'S_SPAWN_COLLECTION', 4, (event) => {
            this.LoggedData["spawns"]["gatheringnodes"].push({
                "id": event.id,
                "amount": event.amount,
                "continent": this.StateTracker.MyContinent,
                "x": event.loc.x,
                "y": event.loc.y,
                "z": event.loc.z,
                "w": event.w || 0,
            });
        })

        this.installHook(mod, 'S_SPAWN_WORKOBJECT', 3, (event) => {
            this.LoggedData["spawns"]["workobjects"].push({
                "id": event.id,
                "continent": this.StateTracker.MyContinent,
                "x": event.loc.x,
                "y": event.loc.y,
                "z": event.loc.z,
                "w": event.w,
            });
        })

        this.installHook(mod, 'S_SPAWN_BONFIRE', 2, (event) => {
            this.LoggedData["spawns"]["bonfires"].push({
                "id": event.id,
                "continent": this.StateTracker.MyContinent,
                "x": event.loc.x,
                "y": event.loc.y,
                "z": event.loc.z,
                "state": event.status,
            });
        })

        this.installHook(mod, 'S_SPAWN_SHUTTLE', 3, (event) => {
            this.LoggedData["spawns"]["shuttles"].push({
                "id": event.shuttle,
                "continent": this.StateTracker.MyContinent,
                "x": event.loc.x,
                "y": event.loc.y,
                "z": event.loc.z,
                "w": event.w,
            });
        })

        this.installHook(mod, 'S_SPAWN_DOOR', 3, (event) => {
            this.LoggedData["spawns"]["doors"].push({
                "id": event.id,
                "continent": this.StateTracker.MyContinent,
            });
        })

        this.installHook(mod, 'S_SPAWN_DROPITEM', 6, (event) => {
            if (event.explode)
            {
                let npc_id = event.source.toString();
                if(this.StateTracker.SpawnedNPCs[npc_id])
                {
                    if(this.LoggedData["kills"][npc_id])
                    {
                        this.LoggedData["kills"][npc_id]["drops"].push({
                            "id": event.item,
                            "amount": event.amount,
                            "masterwork": event.masterwork,
                            "enchant": event.enchant,
                        });
                    }
                }
            }
        })

        this.installHook(mod, 'C_NPC_CONTACT', 2, (event) => {
            this.CurrentNPC = event.gameId.toString();
        })

        this.installHook(mod, 'S_DIALOG', 1, (event) => {
            this.LastDialogButtons = event.buttons;
            this.LastDialogButtonTime = Date.now();
            this.LastDialogButton = null;

            let npc = this.StateTracker.SpawnedNPCs[event.npc.toString()];
            if(npc)
                this.LoggedData["dialogs"][npc["huntingZoneId"] + "," + npc["templateId"] + "," + event.dialogType + "," + event.key1 + "," + event.key2 + "," + event.text] = {'buttons': event.buttons};
        })

        this.installHook(mod, 'C_DIALOG', 1, (event) => {
            if(this.LastDialogButtons == null)
                return;

            for(let i = 0; i < this.LastDialogButtons.length; i++)
            {
                if (this.LastDialogButtons[i]['index'] == event.index)
                {
                    this.LastDialogButton = this.LastDialogButtons[i];
                    this.LastDialogButtonTime = Date.now();
                    break;
                }
            }
        })

        this.installHook(mod, 'S_STORE_SELL_LIST', 1, (event) => {
            let npc = this.StateTracker.SpawnedNPCs[this.CurrentNPC];
            if(npc) {
                event.tabs.forEach(tab => { tab.items.forEach(item => { item.netPrice = (mod.platform !== 'classic') ? item.netPrice.toString() : "0" }) });
                this.LoggedData["shops"]["npc"][npc["huntingZoneId"] + "," + npc["templateId"]] = {'button': event.button, 'tabs': event.tabs};
            }
        })

        this.installHook(mod, 'S_POINT_STORE_SELL_LIST', 1, (event) => {
            let npc = this.StateTracker.SpawnedNPCs[this.CurrentNPC];
            if(npc)
                this.LoggedData["shops"]["factiontoken"][npc["huntingZoneId"] + "," + npc["templateId"]] = {'button': event.button, 'faction': event.faction, 'tabs': event.tabs};
        })

        this.installHook(mod, 'S_BATTLE_FIELD_POINT_STORE_SELL_LIST', 1, (event) => {
            let npc = this.StateTracker.SpawnedNPCs[this.CurrentNPC];
            if(npc)
                this.LoggedData["shops"]["battlegroundtoken"][npc["huntingZoneId"] + "," + npc["templateId"]] = {'button': event.button, 'faction': event.faction, 'tabs': event.tabs};
        })

        if (mod.majorPatchVersion >= 47) {
            this.installHook(mod, 'S_GUILD_STORE_SELL_LIST', 1, (event) => {
                let npc = this.StateTracker.SpawnedNPCs[this.CurrentNPC];
                if(npc) {
                    event.tabs.forEach(tab => { tab.items.forEach(item => { item.netPrice = item.netPrice.toString() }) });
                    this.LoggedData["shops"]["guild"][npc["huntingZoneId"] + "," + npc["templateId"]] = {'button': event.button, 'tabs': event.tabs};
                }
            })
        }

        this.installHook(mod, 'S_SHOW_PEGASUS_MAP', 1, (event) => {
            let npc = this.StateTracker.SpawnedNPCs[this.CurrentNPC];
            if(npc)
                this.LoggedData["pegasus"][npc["huntingZoneId"] + "," + npc["templateId"]] = {'routes': event.routes};
        })

        this.installHook(mod, 'S_TELEPORT_TO_CAMP', 1, (event) => {
            let npc = this.StateTracker.SpawnedNPCs[this.CurrentNPC];
            if(npc) {
                event.destinations.forEach( x => { x.price = x.price.toString() } );
                this.LoggedData["campteleport"][npc["huntingZoneId"] + "," + npc["templateId"]] = {'x': event.x, 'y': event.y, 'z': event.z, 'unk1': event.unk1, 'unk2': event.unk2, 'destinations': event.destinations};
            }
        })

        this.installHook(mod, 'S_COLLECTION_PICKEND', 2, (event) => {
            let node = this.StateTracker.SpawnedGatheringNodes[event.collection.toString()];
            if (event.user.toString() == this.StateTracker.MyID && event.type == 3)
            {
                this.LastGatheringNodePicked = node;
                this.LastGatheringNodePickTime = Date.now();
            }
        })

        this.installHook(mod, 'S_SYSTEM_MESSAGE_LOOT_ITEM', 1, (event) => {
            if (this.LastGatheringNodePicked && this.LastGatheringNodePickTime && Date.now() - this.LastGatheringNodePickTime < 750)
            {
                this.LoggedData["gatheringnodeloot"].push({
                    "id": this.LastGatheringNodePicked['dataId'],
                    "item": event.item,
                    "amount": event.amount,
                });
            }
            else if(this.HasOpenedLootBox && this.LastUseItemTime && Date.now() - this.LastUseItemTime < 2000)
            {
                this.LoggedData["lootboxes"][this.LoggedData["lootboxes"].length - 1]["drops"].push({
                    "item": event.item,
                    "amount": event.amount,
                });
            }
            else if(this.LastGachaActive)
            {
                this.LoggedData["gacha"][this.LoggedData["gacha"].length - 1]["drops"].push({
                    "item": event.item,
                    "amount": event.amount,
                });
            }
        })

        this.installHook(mod, 'S_SYSTEM_MESSAGE_LOOT_SPECIAL_ITEM', 1, (event) => {
            if (this.LastGatheringNodePicked && this.LastGatheringNodePickTime && Date.now() - this.LastGatheringNodePickTime < 750)
            {
                let item_id = event.id;
                let item_amount = event.amount;
                if(!item_id || !item_amount)
                {
                    let msg = this.mod.parseSystemMessage(event.sysmsg);
                    if(msg.tokens.ItemName && msg.tokens.ItemAmount) {
                        item_id = parseInt(msg.tokens.ItemName.replace('@item:', ''));
                        item_amount = parseInt(msg.tokens.ItemAmount);
                    }
                }

                if(item_id && item_amount) {
                    this.LoggedData["gatheringnodeloot"].push({
                        "id": this.LastGatheringNodePicked['dataId'],
                        "item": event.id,
                        "amount": event.amount,
                    });
                }
            }
            else if(this.HasOpenedLootBox && this.LastUseItemTime && Date.now() - this.LastUseItemTime < 2000)
            {
                this.LoggedData["lootboxes"][this.LoggedData["lootboxes"].length - 1]["drops"].push({
                    "item": event.id,
                    "amount": event.amount,
                });
            }
            else if(this.LastGachaActive)
            {
                this.LoggedData["gacha"][this.LoggedData["gacha"].length - 1]["drops"].push({
                    "item": event.id,
                    "amount": event.amount,
                });
            }
        })

        this.installHook(mod, 'S_REQUEST_CONTRACT', 1, (event) => {
            this.HasOpenedLootBox = false;
            this.LastGachaActive = false;
            this.LastTeleportalID = null;
            this.LastTeleportalTime = null;

            if (event.type == (mod.platform === 'classic' ? 16 : 15)) {
                this.LastTeleportalID = event.data.readUInt32LE(4);
                this.LastTeleportalTime = Date.now();
            } else if(event.type == 71) {
                this.LastTeleportalID = event.data.readUInt32LE(0);
                this.LastTeleportalTime = Date.now();

                let npc = this.StateTracker.SpawnedNPCs[this.CurrentNPC]
                if(npc && this.LastDialogButton && this.LastDialogButtonTime + 20000 >= Date.now() && this.LastDialogButton['text'] == '@npc:67')
                    this.LoggedData["nearesttownteleports"][npc["huntingZoneId"] + "," + npc["templateId"]] = this.LastTeleportalID;
            } else if(event.type == 43) {
                if(this.LastUseItemEvent)
                {
                    this.HasOpenedLootBox = true;
                    this.LoggedData["lootboxes"].push({
                       "id": this.LastUseItemEvent.id,
                       "drops": [],
                    });
                }
            }
        })

        this.installHook(mod, 'S_RETURN_TO_LOBBY', 'raw', (event) => {
            this.finishSession();
        })

        this.installHook(mod, 'C_USE_ITEM', 3, (event) => {
            this.HasOpenedLootBox = false;
            this.LastGachaActive = false;
            this.LastUseItemEvent = event;
            this.LastUseItemTime = Date.now();
        })

        this.installHook(mod, 'S_SYSTEM_MESSAGE', 1, (event) => {
            let msg = this.mod.parseSystemMessage(event.message);
            switch(msg.id)
            {
                case "SMT_CANNOT_USE_ITEM_WHILE_CONTRACT":
                case "SMT_CANNOT_CONVERT_EVENT_SEED":
                {
                    this.LastUseItemEvent = null;
                    this.LastUseItemTime = null;
                    this.HasOpenedLootBox = false;
                    break;
                }
                case "SMT_GACHA_REWARD":
                {
                    if(msg.tokens.gachaItemName && msg.tokens.randomItemName && msg.tokens.randomItemCount) {
                        let gachaItemId = msg.tokens.gachaItemName.replace('@item:', '');
                        let randomItemId = msg.tokens.randomItemName.replace('@item:', '');

                        if(gachaItemId != 0 && randomItemId != 0) {
                            let randomItem = randomItemId + ',' + msg.tokens.randomItemCount;

                            if(!this.LoggedData["gachamsg"][gachaItemId])
                                this.LoggedData["gachamsg"][gachaItemId] = [];

                            if (this.LoggedData["gachamsg"][gachaItemId].indexOf(randomItem) < 0)
                                this.LoggedData["gachamsg"][gachaItemId].push(randomItem);
                        }
                    }
                    break;
                }
            }
        })

        this.installHook(mod, 'S_GACHA_START', 1, (event) => {
            this.LastGachaContract = event.id;
            this.LastGachaItem = event.gachaItem;
        })

        this.installHook(mod, 'C_GACHA_TRY', 1, (event) => {
            if(event.id == this.LastGachaContract)
            {
                this.LastGachaActive = true;
                this.LoggedData["gacha"].push({
                   "id": this.LastGachaItem,
                   "drops": [],
                });
            }
            else
            {
                this.LastGachaActive = false;
            }
        })

        this.installHook(mod, 'S_GACHA_END', 1, (event) => {
            this.LastGachaContract = null;
            this.LastGachaItem = null;
            this.LastGachaActive = false;
        })

        this.installHook(mod, 'S_ENABLE_DISABLE_SELLABLE_ITEM_LIST', 1, (event) => {
            if(this.StateTracker.MyContinent && this.StateTracker.MyLocation) {
                let pos = this.StateTracker.MyContinent.toString() + "," + this.StateTracker.MyLocation[0].toString() + "," + this.StateTracker.MyLocation[1].toString() + "," + this.StateTracker.MyLocation[2].toString();
                if(!this.LoggedData["restricted_items"][pos])
                    this.LoggedData["restricted_items"][pos] = {"type1": {}, "type2": {}, "type3": {}}

                for(let item of event.items1)
                    this.LoggedData["restricted_items"][pos]["type1"][item.id] = event.enabled1;
                for(let item of event.items2)
                    this.LoggedData["restricted_items"][pos]["type2"][item.id] = event.enabled2;
                for(let item of event.items3)
                    this.LoggedData["restricted_items"][pos]["type3"][item.id] = event.enabled3;
            }
        })

        if (mod.platform !== 'classic') {
            this.installHook(mod, 'C_START_PRODUCE', 1, (event) => {
                this.finalizeCraftingData();

                this.LastCraftingRecipe = event.recipe;
                this.LastCraftingAdditive = event.unk;
                this.LastCraftingCritical = null;
                this.LastCraftingTimer = Date.now();
                this.LastCraftingState = 1;
            })

            this.installHook(mod, 'S_START_PRODUCE', 3, (event) => {
                if(this.LastCraftingState === 1 && this.LastCraftingTimer + 5000 >= Date.now()) {
                    this.LastCraftingCritical = false;
                    this.LastCraftingTimer = event.duration;
                    this.LastCraftingState = 2;
                } else {
                    this.LastCraftingRecipe = null;
                    this.LastCraftingState = null;
                }
            })

            this.installHook(mod, 'S_END_PRODUCE', 1, (event) => {
                if(event.success && this.LastCraftingState === 2 && this.LastCraftingRecipe) {
                    if(this.LastCraftingCritical)
                        this.finalizeCraftingData();
                    else
                        this.CraftingFinishTimeout = mod.setTimeout(() => { this.finalizeCraftingData(); }, 500);
                } else {
                    this.LastCraftingRecipe = null;
                    this.LastCraftingAdditive = null;
                    this.LastCraftingCritical = null;
                    this.LastCraftingTimer = null;
                    this.LastCraftingState = null;
                }
            })

            this.installHook(mod, 'S_PRODUCE_CRITICAL', 1, (event) => {
                if(this.LastCraftingState === 2) {
                    this.LastCraftingCritical = true;
                    this.finalizeCraftingData();
                }
            })
        }

        this.installHook(mod, 'S_NPC_LOCATION', 3, (event) => {
            let cid = event.gameId.toString();
            let npc = this.StateTracker.SpawnedNPCs[cid];
            if(npc && npc['villager'] && npc['status'] == 0) {
                let npc_id = npc['huntingZoneId'] + ',' + npc['templateId'];

                // We don't want to be spammed with data about Velika guard NPCs...
                if(npc_id !== '63,1909') {
                    if(!this.LoggedData["npcmovement"][npc_id])
                        this.LoggedData["npcmovement"][npc_id] = {};

                    if(!this.LoggedData["npcmovement"][npc_id][cid]) {
                        this.LoggedData["npcmovement"][npc_id][cid] = {
                            "continent": this.StateTracker.MyContinent,
                            "events": [],
                        };
                    }

                    let new_event = {
                        "from": [event.loc.x, event.loc.y, event.loc.z, event.w],
                        "to": [event.dest.x, event.dest.y, event.dest.z],
                        "speed": event.speed,
                    };

                    if (this.LoggedData["npcmovement"][npc_id][cid]["events"].indexOf(new_event) < 0)
                        this.LoggedData["npcmovement"][npc_id][cid]["events"].push(new_event);
                }
            }
        })

        this.installHook(mod, 'S_GROUP_NPC_LOCATION', 1, (event) => {
            let npc_data_ids = {};
            let new_event = [];
            for(let npc_data of event.npcs)
            {
                let cid = npc_data.gameId.toString();
                let npc = this.StateTracker.SpawnedNPCs[cid];
                if(npc)
                {
                    let npc_id = npc['huntingZoneId'] + ',' + npc['templateId'];
                    npc_data_ids[npc_id] = (npc_data_ids[npc_id] || 0) + 1;

                    new_event.push({
                        "id": cid,
                        "data_id": npc_id,
                        "from": [npc_data.loc.x, npc_data.loc.y, npc_data.loc.z, npc_data.w],
                        "to": [npc_data.dest.x, npc_data.dest.y, npc_data.dest.z],
                        "speed": npc_data.speed,
                    });
                }
            }

            let event_idx = Object.entries(npc_data_ids).map(([k, v]) => `${k}:${v}`).join('|');
            if(!this.LoggedData["groupnpcmovement"][event_idx])
            {
                this.LoggedData["groupnpcmovement"][event_idx] = {
                    "continent": this.StateTracker.MyContinent,
                    "events": [],
                };
            }

            if (this.LoggedData["groupnpcmovement"][event_idx]["events"].indexOf(new_event) < 0)
                this.LoggedData["groupnpcmovement"][event_idx]["events"].push(new_event);
        })

        this.installHook(mod, 'S_ACTION_STAGE', 8, (event) => {
            let cid = event.gameId.toString();
            let npc = this.StateTracker.SpawnedNPCs[cid];
            if(npc) {
                let npc_id = npc['huntingZoneId'] + ',' + npc['templateId'];

                if(!this.LoggedData["npcskills"][npc_id])
                    this.LoggedData["npcskills"][npc_id] = [];

                let new_skill = event.templateId + ',' + event.skill.npc + ',' + event.skill.type + ',' + event.skill.huntingZoneId + ',' + event.skill.id + ',' + event.skill.reserved;
                if (this.LoggedData["npcskills"][npc_id].indexOf(new_skill) < 0)
                    this.LoggedData["npcskills"][npc_id].push(new_skill);
            }
        })

        this.installHook(mod, 'S_FIX_VEHICLE_PROGRESS', 1, (event) => {
            let cid = event.gameId.toString();
            let npc = this.StateTracker.SpawnedNPCs[cid];
            if(npc) {
                let npc_id = npc['huntingZoneId'] + ',' + npc['templateId'];

                if(!this.LoggedData["npcvehiclefix"][npc_id])
                    this.LoggedData["npcvehiclefix"][npc_id] = [];

                this.LoggedData["npcvehiclefix"][npc_id].push({
                    pointsPerSec: event.pointsPerSec,
                    broadcast: event.broadcast,
                });
            }
        })

        this.installHook(mod, 'S_LOAD_DUNGEON_SOUND_HINT', 1, (event) => {
            let sounds = [];
            for(let sound of event.sounds)
                sounds.push(sound.id);

            this.LoggedData["dungeonsounds"][this.StateTracker.MyContinent] = sounds;
        })

        if (mod.majorPatchVersion >= 53) {
            this.installHook(mod, 'S_GMEVENT_GUIDE_MESSAGE', 1, (event) => {
                this.LoggedData["gmevents"]["events"].push({
                    type: event.type,
                    id: event.id,
                    name: event.name,
                });
            })

            this.installHook(mod, 'S_GMEVENT_OX_QUIZ_OPEN', 1, (event) => {
                this.LoggedData["gmevents"]["questions"].push(event);
            })

            this.installHook(mod, 'S_GMEVENT_OX_QUIZ_RESULT', 1, (event) => {
                this.LoggedData["gmevents"]["answers"].push(event);
            })

            this.installHook(mod, 'S_GMEVENT_RECV_REWARD', 2, (event) => {
                this.LoggedData["gmevents"]["rewards"].push(event);
            })
        }

        this.installHook(mod, 'S_HOLD_ABNORMALITY_ADD', 2, (event) => {
            if (this.LoggedData["heldabnormalities"].indexOf(event.id) < 0)
                this.LoggedData["heldabnormalities"].push(event.id);
        })

        this.installHook(mod, 'S_MOUNT_VEHICLE', 2, (event) => {
            if (event.gameId.toString() == this.StateTracker.MyID) {
                this.LastVehicleId = event.id;
                this.LastVehicleTimer = Date.now();
            }
        })

        this.installHook(mod, 'S_SHORTCUT_CHANGE', 2, (event) => {
            if (this.LastVehicleId && this.LastVehicleTimer && this.LastVehicleTimer + 1000 >= Date.now()) {
                if (event.enable)
                    this.LoggedData["vehicleshortcutsets"][this.LastVehicleId] = event.id;

                this.LastVehicleId = null;
                this.LastVehicleTimer = null;
            }
        })

        this.installHook(mod, 'S_SOCIAL', 1, (event) => {
            let cid = event.target.toString();
            let npc = this.StateTracker.SpawnedNPCs[cid];
            if(npc) {
                let npc_id = npc['huntingZoneId'] + ',' + npc['templateId'];

                if(!this.LoggedData["npcsocials"][npc_id])
                    this.LoggedData["npcsocials"][npc_id] = {};
                if(!this.LoggedData["npcsocials"][npc_id][npc['status']])
                    this.LoggedData["npcsocials"][npc_id][npc['status']] = [];
                if (this.LoggedData["npcsocials"][npc_id][npc['status']].indexOf(event.animation) < 0)
                    this.LoggedData["npcsocials"][npc_id][npc['status']].push(event.animation);
            }
        })

        this.installHook(mod, 'S_ABNORMALITY_BEGIN', 3, (event) => {
            let cid = event.target.toString();
            if (cid == this.StateTracker.MyID) {
                this.LastAbnormalityId = event.id;
                this.LastAbnormalityTimer = Date.now();
            }

            if(this.StateTracker.SpawnedPlayers[cid]) {
                this.storeAbnormalities(this.StateTracker.SpawnedPlayers[cid]['abnormalities']);
            } else if(this.StateTracker.SpawnedNPCs[cid]) {
                let npc = this.StateTracker.SpawnedNPCs[cid];
                this.storeAbnormalities(npc['abnormalities']);

                if (npc['hp'] == null && npc['status'] == 0 && npc['spawnTime'] + 1000 >= Date.now()) {
                    let npc_id = npc['huntingZoneId'] + ',' + npc['templateId'];
                    if (!this.LoggedData["npcspawnabnormalities"][npc_id])
                        this.LoggedData["npcspawnabnormalities"][npc_id] = [];
                    if (this.LoggedData["npcspawnabnormalities"][npc_id].indexOf(event.id) < 0)
                        this.LoggedData["npcspawnabnormalities"][npc_id].push(event.id);
                }
            }
        })

        if(mod.majorPatchVersion >= 62) {
            this.installHook(mod, 'S_FONT_SWAP_INFO', 3, (event) => {
                if (this.LastAbnormalityId && this.LastAbnormalityTimer && this.LastAbnormalityTimer + 500 >= Date.now() && event.id != 0) {
                    this.LoggedData["fontswap"][this.LastAbnormalityId] = event.id;

                    this.LastAbnormalityId = null;
                    this.LastAbnormalityTimer = null;
                }
            })

        }

        if(mod.majorPatchVersion >= 52) {
            this.installHook(mod, 'S_NOCTAN_VARIATION_INFO', 1, (event) => {
                if (this.LastAbnormalityId && this.LastAbnormalityTimer && this.LastAbnormalityTimer + 500 >= Date.now() && event.id != 0) {
                    this.LoggedData["noctvariation"][this.LastAbnormalityId] = event.id;

                    this.LastAbnormalityId = null;
                    this.LastAbnormalityTimer = null;
                }
            })
        }

        this.installHook(mod, 'S_SKILL_ATTENTION_TARGET', 1, (event) => {
            let skill_id = event.sourceTemplateId + ',' + event.sourceSkillId.npc + ',' + event.sourceSkillId.type + ',' + event.sourceSkillId.huntingZoneId + ',' + event.sourceSkillId.id + ',' + event.sourceSkillId.reserved;
            if (!this.LoggedData["attentionskills"][skill_id]) {
                this.LoggedData["attentionskills"][skill_id] = [event.sourceSkillStageId];
            } else {
                if (this.LoggedData["attentionskills"][skill_id].indexOf(event.sourceSkillStageId) < 0)
                    this.LoggedData["attentionskills"][skill_id].push(event.sourceSkillStageId);
            }
        })

        if (mod.majorPatchVersion >= 77) {
            this.installHook(mod, 'S_COLLECTION_PICKSTART', 2, (event) => {
                let node = this.StateTracker.SpawnedGatheringNodes[event.collection.toString()];
                if (node)
                    this.LoggedData["gatheringnodetime"][node['dataId']] = event.duration.toString();
            })
        }
    }

    finalizeCraftingData()
    {
        if(this.LastCraftingState === 2 && this.LastCraftingRecipe) {
            this.LoggedData["crafting_results"].push({
                "recipe": this.LastCraftingRecipe,
                "additive": this.LastCraftingAdditive,
                "time": this.LastCraftingTimer.toString(),
                "crit": this.LastCraftingCritical,
                "abnormalityset_id": this.storeAbnormalities(this.StateTracker.SpawnedPlayers[this.StateTracker.MyID]['abnormalities']),
                "gearset_id": this.storeCurrentGearSet(),
            });
        }

        if(this.CraftingFinishTimeout) {
            this.mod.clearTimeout(this.CraftingFinishTimeout);
            this.CraftingFinishTimeout = null;
        }

        this.LastCraftingRecipe = null;
        this.LastCraftingAdditive = null;
        this.LastCraftingCritical = null;
        this.LastCraftingTimer = null;
        this.LastCraftingState = null;
    }

    storeAbnormalities(abnormalityset)
    {
        let abnormalityset_id = crypto.createHash('sha1').update(JSON.stringify(abnormalityset)).digest().toString('hex');

        if(!this.LoggedData["abnormalitysets"][abnormalityset_id])
            this.LoggedData["abnormalitysets"][abnormalityset_id] = abnormalityset;

        return abnormalityset_id;
    }

    storeCurrentGearSet()
    {
        let glyphs = []
        for(let glyph in this.StateTracker.MyGlyphs)
        {
            if(this.StateTracker.MyGlyphs[glyph] == 1)
                glyphs.push(parseInt(glyph));
        }

        let gearset = {
            'passivities': this.StateTracker.MyPassivities,
            'glyphs': glyphs,
            'equipment': this.StateTracker.MyEquipment,
        };

        let gearset_id = crypto.createHash('sha1').update(JSON.stringify(gearset)).digest().toString('hex');

        if(!this.LoggedData["gearsets"][gearset_id])
            this.LoggedData["gearsets"][gearset_id] = gearset;

        return gearset_id;
    }

    reset()
    {
        this.CurrentNPC = null;
        this.LastGatheringNodePicked = null;
        this.LastGatheringNodePickTime = null;
        this.LastDialogButtons = null;
        this.LastDialogButtonTime = null;
        this.LastDialogButton = null;
        this.LastTeleportalID = null;
        this.LastTeleportalTime = null;
        this.SafeHavenResActive = false;
        this.CurDeathLocation = null;
        this.LastUseItemEvent = null;
        this.LastUseItemTime = null;
        this.HasOpenedLootBox = false;
        this.LastGachaContract = null;
        this.LastGachaItem = null;
        this.LastGachaActive = false;
        this.LastCraftingRecipe = null;
        this.LastCraftingAdditive = null;
        this.LastCraftingCritical = null;
        this.LastCraftingTimer = null;
        this.LastCraftingState = null;
        this.CraftingFinishTimeout = null;
        this.LastVehicleId = null;
        this.LastVehicleTimer = null;
        this.LastAbnormalityId = null;
        this.LastAbnormalityTimer = null;

        this.LoggedData = {
            "version": 36,
            "majorPatch": null,
            "protocol": null,
            "templateId": null,
            "spawns": {
                "npcs": [],
                "gatheringnodes": [],
                "workobjects": [],
                "bonfires": [],
                "shuttles": [],
                "doors": [],
            },
            "shops": {
                "npc": {},
                "factiontoken": {},
                "battlegroundtoken": {},
                "guild": {},
            },
            "pegasus": {},
            "campteleport": {},
            "patrols": [],
            "dialogs": {},
            "nearesttownteleports": {},
            "exp": [],
            "gatheringnodeloot": [],
            "reslocs": [],
            "teleportals": {},
            "kills": {},
            "lootboxes": [],
            "gacha": [],
            "aimsg": {},
            "enchant": [],
            "upgrade": [],
            "abnormalitysets": {},
            "gearsets": {},
            "statsets": {},
            "restricted_items": {},
            "crafting_results": [],
            "npcmovement": {},
            "groupnpcmovement": {},
            "npcskills": {},
            "dungeonsounds": {},
            "gmevents": {
                "events": [],
                "questions": [],
                "answers": [],
                "rewards": [],
            },
            "gachamsg": {},
            "heldabnormalities": [],
            "vehicleshortcutsets": {},
            "npcsocials": {},
            "fontswap": {},
            "gatheringnodetime": {},
            "noctvariation": {},
            "npcspawnabnormalities": {},
            "attentionskills": {},
            "npcenrage": {},
            "npcvehiclefix": {},
        };
    }

    tryUploadSession(LogData, OnSuccess, OnError, ServerIndex = 0)
    {
        request(
            {
                url: UploadServerURLs[ServerIndex] + 'upload.php',
                method: 'PUT',
                body: LogData,
            },

            (err, res, data) => {
                if(err || data != 'OK') {
                    // Try the next server
                    if(ServerIndex + 1 < UploadServerURLs.length)
                        this.tryUploadSession(LogData, OnSuccess, OnError, ServerIndex + 1);
                    else
                        OnError(LogData, ServerIndex);
                }
                else
                {
                    OnSuccess(LogData, ServerIndex);
                }
            }
        );
    }

    finishSession()
    {
        // Skip empty/server emulator logs
        if(this.LoggedData["starttime"] != undefined && !this.isOnServerEmulator) {
            let username_hash = crypto.createHash('sha256').update(this.StateTracker.MyAccountName || '').digest().toString('hex');
            let contributor_id = this.StateTracker.MyLanguage.toString() + '-' + username_hash;

            this.LoggedData["duration"] = Date.now() - this.LoggedData["starttime"];
            this.LoggedData["language"] = this.StateTracker.MyLanguage;
            this.LoggedData["server"] = this.StateTracker.MyServerID;
            this.LoggedData["majorPatch"] = this.mod.majorPatchVersion;
            this.LoggedData["protocol"] = this.mod.protocolVersion;
            this.LoggedData["username"] = username_hash;
            this.LoggedData["console"] = this.mod.isConsole;
            this.LoggedData["classic"] = this.mod.isClassic;

            let compressed_log = zlib.gzipSync(JSON.stringify(this.LoggedData));
            let log_folder = path.join(__dirname, 'logs');

            this.tryUploadSession(compressed_log,
                (LogData, ServerIndex) => {
                    console.log('[CaaliLogger] Log successfully auto-uploaded to upload server ' + ServerIndex.toString() + ', thank you for your contribution!');
                    console.log('[CaaliLogger] Your unique contributor ID is [' + contributor_id + '].');

                    // Upload succeeded, retry uploading all previously failed logs
                    if(fs.existsSync(log_folder)) {
                        fs.readdirSync(log_folder).forEach(file => {
                            let filename = path.join(log_folder, file);
                            this.tryUploadSession(fs.readFileSync(filename),
                                (LogData, ServerIndex) => {
                                    fs.unlinkSync(filename);
                                },

                                (LogData, ServerIndex) => {

                                },

                                ServerIndex
                            );
                        });
                    }
                },

                (LogData, ServerIndex) => {
                    if (!fs.existsSync(log_folder))
                        fs.mkdirSync(log_folder);

                    fs.writeFileSync(path.join(log_folder, Date.now().toString() + ".json.gz"), LogData);
                    console.log('[CaaliLogger] Unable to auto-upload the log, it has been saved to your computer and will be uploaded later!');
                    console.log('[CaaliLogger] Your unique contributor ID is [' + contributor_id + '].');
                }
            );
        }

        this.reset()
    }
}

module.exports = CaaliLogger;
