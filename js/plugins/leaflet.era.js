import "../leaflet.js";

(function (factory) {
    var L;
    if (typeof define === "function" && define.amd) {
        define(["leaflet"], factory);
    } else if (typeof module !== "undefined") {
        L = require("leaflet");
        module.exports = factory(L);
    } else {
        if (typeof window.L === "undefined") {
            throw new Error("Leaflet must be loaded first");
        }
        factory(window.L);
    }
})(function (L) {
    L.Control.EraSelector = L.Control.extend({
        options: {
            position: "bottomcenter",
            id: "eraselector",
            title: "",
            classes: "leaflet-control-eraselector",
        },
        _container: null,

        onAdd: function (map) {
            this._map = map;

            let range = L.DomUtil.create("input", "leaflet-control-era-range");
            L.DomEvent.disableClickPropagation(range);
            range.setAttribute("type", "range");
            range.setAttribute("name", "Era");

            fetch(map.options.era_structure)
                .then((res) => res.json())

                .then((era_structure) => {
                    range.setAttribute("min", 0);
                    range.setAttribute("max", era_structure.length - 1);

                    let initial_era = map._era;

                    /// Permit a layer named "dummy" outside the era structure
                    if (initial_era === "dummy") {
                        return
                    }

                    let initialSliderPos = era_structure.findIndex((elem) => elem.key === initial_era);

                    if (initialSliderPos === -1) {
                        console.warn(`Initial era "${initial_era}" not found in "${map.options.era_structure}"`);
                        initialSliderPos = era_structure.length - 1;
                        let dummy = {
                            "stamp": 0,
                            "game": "",
                            "year": 0,
                            "month": 0,
                            "day": 0,
                            "key": "",
                            "sources": []
                        };
                        this._map.setEra(era_structure[initialSliderPos], dummy);
                    }

                    range.setAttribute("value", initialSliderPos);
                    let attr = map.attributionControl;
                    let sources = era_structure[initialSliderPos].sources;
                    if (attr && sources) {
                        for (const source of sources) {
                            attr.addAttribution(source);
                        }
                    }

                    range.addEventListener("change", (e) => {
                        // Disable the input while tiles are loading
                        range.disabled = true;
                        range.style.cursor = "wait";

                        let index = e.target.valueAsNumber;

                        let ready = this._map.setEra(era_structure[index], era_structure[initialSliderPos]);
                        initialSliderPos = index;
                        ready.finally(() => {
                            // The new map is loaded, restore the ability for users to use the slider
                            range.disabled = false;
                            range.style.cursor = "default";
                        });
                    });

                    range.addEventListener("mouseover", (e) => {
                        e.target.focus();
                    });


                    map.addEventListener("keydown", (e) => {
                        if (e.originalEvent.keyCode === 33) {
                            let current = Number(range.value);
                            let next = current + 1;

                            if (next <= era_structure.length - 1) {
                                range.disabled = true;
                                range.style.cursor = "wait";

                                let ready = this._map.setEra(era_structure[next], era_structure[current]);
                                range.setAttribute("value", next);

                                ready.finally(() => {
                                    // The new map is loaded, restore the ability for users to use the slider
                                    range.disabled = false;
                                    range.style.cursor = "default";
                                });
                            }
                        }

                        if (e.originalEvent.keyCode === 34) {
                            let current = Number(range.value);
                            let next = current - 1;
                            if (next >= 0) {
                                range.disabled = true;
                                range.style.cursor = "wait";

                                let ready = this._map.setEra(era_structure[next], era_structure[current]);
                                range.setAttribute("value", next);

                                ready.finally(() => {
                                    // The new map is loaded, restore the ability for users to use the slider
                                    range.disabled = false;
                                    range.style.cursor = "default";
                                });
                            }
                        }
                    });
                })
                .catch(console.error);

            this._messageContainer = L.DomUtil.create("div", "leaflet-control-era-container");
            L.DomEvent.disableClickPropagation(this._messageContainer);
            L.DomEvent.disableScrollPropagation(this._messageContainer);

            this._messageContainer.appendChild(range);
            return this._messageContainer;
        },

        onRemove: function (map) {
            //remove
        },
    });

    L.Map.addInitHook(function () {
        if (this.options.era_structure) {
            this.eraSelectorControl = new L.control.eraSelector(this.options.eraSelectorControl);
            this.addControl(this.eraSelectorControl);
        }
    });

    L.control.eraSelector = function (options) {
        return new L.Control.EraSelector(options);
    };

    let Trivia = L.LayerGroup.extend({
        initialize: function (options) {
            L.LayerGroup.prototype.initialize.call(this, {}, options);
        },

        onAdd: function (map) {
            let url = `https://sheets.googleapis.com/v4/spreadsheets/${this.options.SHEET_ID}/values/A:Z?key=${this.options.API_KEY}`;
            fetch(url)
                .then((res) => res.json())
                .then((sheet) => {
                    this._markers = this.parse_sheet(sheet);
                    let era = map._era;
                    for (const marker of this._markers) {
                        if (marker.start <= era && marker.end >= era) {
                            this.addLayer(marker);
                        }
                    }

                    map.on("erachange", (e) => {
                        for (const marker of this._markers) {
                            if ((marker.start <= e.newEra.key && marker.end >= e.newEra.key)) {
                                this.addLayer(marker);
                            } else {
                                this.removeLayer(marker);
                            }
                        }
                        return Promise.resolve();
                    });
                });
            L.LayerGroup.prototype.eachLayer.call(this, map.addLayer, map);
        },

        onRemove: function (map) {
            for (const marker of this._markers) {
                if (marker.start <= era && marker.end >= era) {
                    this.removeLayer(marker);
                }
            }
            L.LayerGroup.prototype.eachLayer.call(this, map.removeLayer, map);
        },

        parse_sheet: function (sheet) {
            return sheet.values.map((row) => this.create_marker(...row));
        },

        create_marker: function (p, x, y, start, end, link) {
            let marker = L.marker([Number(y), Number(x)], {});
            marker.start = start;
            marker.end = end;

            fetch(link)
                .then((res) => res.text())
                .then((txt) => {
                    let div = document.createElement("a");
                    let raw_description = txt.match(/(?<=meta name="description" content=")(.*?)(?=\"\/\>)/gs)[0];
                    let description = document.createElement("p");
                    description.innerHTML = raw_description;
                    description.setAttribute("class", "preview-txt");
                    div.appendChild(description);

                    let img_url = txt.match(/(?<=meta property="og:image" content=")(.*?)(?=\"\/\>)/gs)[0];
                    let img = L.DomUtil.create("img", "preview-image");
                    img.src = img_url;

                    div.appendChild(img);

                    div.href = link;

                    marker.bindPopup(div);
                });
            return marker;
        },
    });

    L.trivia = function (options) {
        return new Trivia(options);
    };
});
