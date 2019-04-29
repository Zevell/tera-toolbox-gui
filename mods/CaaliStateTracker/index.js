'use strict'

class CaaliStateTracker {
    constructor(mod, AccountName, Language) {
        this.MyAccountName = AccountName;
        this.MyLanguage = Language;
        this.MyServerID = null;
        this.reset();
        this.installHooks(mod);
    }

    installHook(mod, name, version, cb)
    {
        mod.hook(name, version, {order: -1000, filter: {fake: false, modified: false, silenced: null}}, cb);
    }

    installHooks(mod) {
        this.installHook(mod, 'C_LOGIN_ARBITER', 2, (event) => {
            this.MyAccountName = event.name;
            this.MyLanguage = event.language;
        })

        this.installHook(mod, 'C_PLAYER_LOCATION', 5, (event) => {
            this.MyLocation = [event.loc.x, event.loc.y, event.loc.z, event.w];
            this.MyLocationEvent = event;
            this.MyLocationEventTime = Date.now();
        })

        this.installHook(mod, 'C_NOTIFY_LOCATION_IN_ACTION', 4, (event) => {
            this.MyLocation = [event.loc.x, event.loc.y, event.loc.z, event.w];
        })

        if (mod.platform !== 'classic') {
            this.installHook(mod, 'C_NOTIFY_LOCATION_IN_DASH', 4, (event) => {
                this.MyLocation = [event.loc.x, event.loc.y, event.loc.z, event.w];
            })
        }

        this.installHook(mod, 'S_LOGIN', mod.majorPatchVersion >= 81 ? 13 : 12, (event) => {
            this.SpawnedNPCs = {};
            this.SpawnedGatheringNodes = {};
            this.SpawnedPlayers = {};
            this.PlayerCreatureIDs = {};

            this.MyTemplateID = event.templateId;
            this.MyID = event.gameId.toString();
            this.MyServerID = event.serverId;
            this.SpawnedPlayers[this.MyID] = {
                'charId': event.playerId,
                'level': event.level,
                'abnormalities': {},
            };
            this.PlayerCreatureIDs[event.playerId] = this.MyID;
        })

        this.installHook(mod, 'S_USER_LEVELUP', 2, (event) => {
            let cid = event.gameId.toString();
            if (this.SpawnedPlayers[cid] != null)
                this.SpawnedPlayers[cid]['level'] = event.level;
        })

        this.installHook(mod, 'S_PLAYER_STAT_UPDATE', 10, (event) => {
            this.MyStats = event;
        })

        this.installHook(mod, 'S_CREATURE_CHANGE_HP', 6, (event) => {
            let cid = event.target.toString();
            if(cid == this.MyID && this.MyStats)
            {
                this.MyStats.hp = event.curHp;
            }
            else if(this.SpawnedNPCs[cid])
            {
                this.SpawnedNPCs[cid]['hp'] = event.curHp;
            }
        })

        this.installHook(mod, 'S_PLAYER_CHANGE_MP', 1, (event) => {
            let cid = event.target.toString();
            if(cid == this.MyID && this.MyStats)
                this.MyStats.mp = event.currentMp;
        })

        this.installHook(mod, 'S_PLAYER_CHANGE_STAMINA', 1, (event) => {
            if(this.MyStats)
                this.MyStats.stamina = event.current;
        })

        this.installHook(mod, 'S_INVEN', 18, (event) => {
            if(event.first)
                this.MyEquipment = {};

            for(let item of event.items)
            {
                if(item.slot <= 13 || item.slot == 19 || item.slot == 20)
                {
                    let passivities = [];
                    let masterworkBonus = 0;

                    let activePassivities = item.passivitySets[item.passivitySet];
                    if(activePassivities) {
                        for(let passivity of activePassivities.passivities)
                        {
                            if(passivity.id != 0)
                                passivities.push(passivity.id);
                        }

                        masterworkBonus = activePassivities.masterworkBonus;
                    }

                    for(let passivity of item.mergedPassivities)
                    {
                        if(passivity != 0)
                            passivities.push(passivity);
                    }

                    let crystals = [];
                    if(item.crystal1 != 0)
                        crystals.push(item.crystal1);
                    if(item.crystal2 != 0)
                        crystals.push(item.crystal2);
                    if(item.crystal3 != 0)
                        crystals.push(item.crystal3);
                    if(item.crystal4 != 0)
                        crystals.push(item.crystal4);
                    if(item.crystal5 != 0)
                        crystals.push(item.crystal5);

                    this.MyEquipment[item.slot] = {
                        'id': item.id,
                        'enchant': item.enchant,
                        'crystals': crystals,
                        'masterwork': item.masterwork,
                        'awakened': item.awakened || false,
                        'masterwork_bonus': masterworkBonus,
                        'passivities': passivities,
                    };
                }
            }
        })

        this.installHook(mod, 'S_CREST_INFO', 2, (event) => {
            this.MyGlyphs = {};
            for(let glyph of event.crests)
                this.MyGlyphs[glyph.id] = glyph.enable;
        })

        this.installHook(mod, 'S_CREST_APPLY', 2, (event) => {
            this.MyGlyphs[event.id] = event.enable;
        })

        this.installHook(mod, 'S_LOAD_TOPO', 3, (event) => {
            this.MyContinent = event.zone;
            this.SpawnedNPCs = {};
        })

        this.installHook(mod, 'S_SPAWN_NPC', 11, (event) => {
            let cid = event.gameId.toString();
            this.SpawnedNPCs[cid] = {
                'huntingZoneId': event.huntingZoneId,
                'templateId': event.templateId,
                'location': [event.loc.x, event.loc.y, event.loc.z, event.w],
                'occupierLevel': 0,
                'hp': null,
                'abnormalities': {},
                'villager': event.villager,
                'status': event.status,
                'spawnTime': Date.now(),
                'enraged': event.mode === 1,
            };
        })

        this.installHook(mod, 'S_NPC_STATUS', 2, (event) => {
            let cid = event.gameId.toString();
            if(this.SpawnedNPCs[cid]) {
                this.SpawnedNPCs[cid]['status'] = event.status;
                this.SpawnedNPCs[cid]['enraged'] = event.enraged;
            }
        })

        this.installHook(mod, 'S_NPC_LOCATION', 3, (event) => {
            let cid = event.gameId.toString();
            if(this.SpawnedNPCs[cid])
                this.SpawnedNPCs[cid]['location'] = [event.loc.x, event.loc.y, event.loc.z, event.w];
        })

        this.installHook(mod, 'S_GROUP_NPC_LOCATION', 1, (event) => {
            for(let npc of event.npcs)
            {
                let cid = npc.gameId.toString();
                if(this.SpawnedNPCs[cid])
                    this.SpawnedNPCs[cid]['location'] = [npc.loc.x, npc.loc.y, npc.loc.z, npc.w];
            }
        })

        this.installHook(mod, 'S_CREATURE_ROTATE', 2, (event) => {
            let cid = event.gameId.toString();
            if(this.SpawnedNPCs[cid])
                this.SpawnedNPCs[cid]['location'][3] = event.w;
        })

        this.installHook(mod, 'S_INSTANT_MOVE', 3, (event) => {
            let cid = event.gameId.toString();
            if(cid == this.MyID)
                this.MyLocation = [event.loc.x, event.loc.y, event.loc.z, event.w];
            else if(this.SpawnedNPCs[cid])
                this.SpawnedNPCs[cid]['location'] = [event.loc.x, event.loc.y, event.loc.z, event.w];
        })

        this.installHook(mod, 'S_INSTANT_DASH', 3, (event) => {
            let cid = event.gameId.toString();
            if(cid == this.MyID)
                this.MyLocation = [event.loc.x, event.loc.y, event.loc.z, event.w];
            else if(this.SpawnedNPCs[cid])
                this.SpawnedNPCs[cid]['location'] = [event.loc.x, event.loc.y, event.loc.z, event.w];
        })

        this.installHook(mod, 'S_NPC_OCCUPIER_INFO', 1, (event) => {
            let npc = this.SpawnedNPCs[event.npc.toString()];

            if (this.SpawnedPlayers[event.pid.toString()] && this.SpawnedPlayers[event.pid.toString()]['level'] > npc['occupierLevel'])
                npc['occupierLevel'] = this.SpawnedPlayers[event.pid.toString()]['level'];

            if (this.SpawnedPlayers[event.cid.toString()] && this.SpawnedPlayers[event.cid.toString()]['level'] > npc['occupierLevel'])
                npc['occupierLevel'] = this.SpawnedPlayers[event.cid.toString()]['level'];
        })

        this.installHook(mod, 'S_DESPAWN_NPC', 3, (event) => {
            let cid = event.gameId.toString();
            //delete SpawnedNPCs[cid];
        })

        this.installHook(mod, 'S_SPAWN_USER', 13, (event) => {
            let cid = event.gameId.toString();
            this.SpawnedPlayers[cid] = {
                'charId': event.playerId,
                'level': event.level,
                'abnormalities': {},
            };
            this.PlayerCreatureIDs[event.playerId] = cid;
        })

        this.installHook(mod, 'S_DESPAWN_USER', 3, (event) => {
            let target = event.gameId.toString();
            if(this.SpawnedPlayers[target])
            {
                delete this.PlayerCreatureIDs[this.SpawnedPlayers[target]['charId']];
                delete this.SpawnedPlayers[target];
            }
        })

        this.installHook(mod, 'S_SPAWN_COLLECTION', 4, (event) => {
            this.SpawnedGatheringNodes[event.gameId.toString()] = {'dataId': event.id};
        })

        this.installHook(mod, 'S_DESPAWN_COLLECTION', 2, (event) => {
            delete this.SpawnedGatheringNodes[event.gameId.toString()];
        })

        this.installHook(mod, 'S_RETURN_TO_LOBBY', 'raw', (event) => {
            this.reset();
        })

        this.installHook(mod, 'S_ABNORMALITY_BEGIN', 3, (event) => {
            let cid = event.target.toString();
            let abnormality = {
                'stacks': event.stacks,
            }

            if(this.SpawnedPlayers[cid])
                this.SpawnedPlayers[cid]['abnormalities'][event.id] = abnormality;
            else if(this.SpawnedNPCs[cid])
                this.SpawnedNPCs[cid]['abnormalities'][event.id] = abnormality;
        })

        this.installHook(mod, 'S_ABNORMALITY_REFRESH', 1, (event) => {
            let cid = event.target.toString();
            let abnormality = {
                'stacks': event.stacks,
            }

            if(this.SpawnedPlayers[cid])
                this.SpawnedPlayers[cid]['abnormalities'][event.id] = abnormality;
            else if(this.SpawnedNPCs[cid])
                this.SpawnedNPCs[cid]['abnormalities'][event.id] = abnormality;
        })

        this.installHook(mod, 'S_ABNORMALITY_END', 1, (event) => {
            let cid = event.target.toString();

            if(this.SpawnedPlayers[cid])
                delete this.SpawnedPlayers[cid]['abnormalities'][event.id];
            else if(this.SpawnedNPCs[cid])
                delete this.SpawnedNPCs[cid]['abnormalities'][event.id];
        })

        this.installHook(mod, 'S_SKILL_LIST', 2, (event) => {
            this.MyPassivities = [];
            for(let skill of event.skills) {
                if(!skill.active)
                    this.MyPassivities.push(Number(skill.id & (mod.isClassic ? 0xFFFFFFFF : 0xFFFFFFFFn)) | 0);
            }
        })

        this.installHook(mod, 'S_VISIT_NEW_SECTION', 1, (event) => {
            this.MyCurrentSection = {
                'world': event.mapId,
                'guard': event.guardId,
                'section': event.sectionId,
            }
        })
    }

    reset() {
        this.SpawnedNPCs = {};
        this.SpawnedGatheringNodes = {};
        this.SpawnedPlayers = {};
        this.PlayerCreatureIDs = {};
        this.MyID = null;
        this.MyContinent = null;
        this.MyLocation = null;
        this.MyLocationEvent = null;
        this.MyLocationEventTime = null;
        this.MyTemplateID = null;
        this.MyStats = null;
        this.MyPassivities = [];
        this.MyGlyphs = {};
        this.MyEquipment = {};
        this.MyCurrentSection = null;
    }
}

module.exports = CaaliStateTracker;
